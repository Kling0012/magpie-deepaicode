// magpie 供应商插件入口：DeepAI Code（本机网关 / 直连上游）。
//
// 钩子清单（magpie 会调用的只有这些）：
//   config / auth(methods, loader, usage, checkin) / provider.models / chat.headers
// 导出纪律：入口只导出插件函数与 _internal；辅助函数不要从入口导出。

import {
  aggregatePool,
  getAccounts,
  getModels as getGatewayModels,
  getTheos as getGatewayTheos,
  postCheckin,
  singleAllowance,
} from "./src/gateway.mjs";
import {
  catalogFromDirect,
  catalogFromGateway,
  createCatalogCache,
  fallbackModels,
  modelsFromCatalog,
} from "./src/catalog.mjs";
import { DEFAULT_GATEWAY_URL, DEFAULT_OPTIONS, FALLBACK_SNAPSHOT_DATE, PROVIDER } from "./src/constants.mjs";
import { directBase, getDirectModels, getTheos as getDirectTheos, getUsageSummary, normalizeAllowance } from "./src/direct.mjs";
import { createLoader, normalizeIncomingUrl, guardResponse, loaderTargets, sessionAffinityHeaders } from "./src/fetch.mjs";
import { HttpError } from "./src/http.mjs";
import { ICON_DATA_URI } from "./src/icon.mjs";
import { resolveLang, t } from "./src/i18n.mjs";
import { findDesktopCredentials } from "./src/credentials.mjs";
import { createMethods, startCallbackServer } from "./src/login.mjs";
import {
  accountMachineId,
  detectDeviceRaw,
  machineFingerprint,
  parseUuid,
  sha256Hex,
  uuidV5,
} from "./src/machine.mjs";
import { MODE_GATEWAY, accountIdFor, modeOf, resolveAccountSettings, LOOPBACK_KEY } from "./src/modes.mjs";
import {
  buildDirectCheckin,
  buildDirectUsage,
  buildGatewayCheckin,
  buildGatewaySingleUsage,
  buildGatewayUsage,
} from "./src/usage.mjs";
import { describeError, formatNumber, isZeroCost, parseResetTime, toNumber, trimSlash } from "./src/util.mjs";

/** 合并选项来源：函数第二参 + magpie 的 options/option。 */
export function resolveOptions(input, options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options && typeof options === "object" ? options : {}),
    ...(input?.magpie?.options && typeof input.magpie.options === "object" ? input.magpie.options : {}),
    ...(input?.magpie?.option && typeof input.magpie.option === "object" ? input.magpie.option : {}),
  };
  return {
    ...merged,
    mode: String(merged.mode ?? "").toLowerCase() === "direct" ? "direct" : "gateway",
    gatewayUrl: String(merged.gatewayUrl || DEFAULT_GATEWAY_URL).trim(),
    gatewayKey: String(merged.gatewayKey ?? "").trim(),
    gatewayAdmin: String(merged.gatewayAdmin ?? "").trim(),
    baseOrigin: String(merged.baseOrigin || DEFAULT_OPTIONS.baseOrigin).trim(),
    laneVersion: String(merged.laneVersion || DEFAULT_OPTIONS.laneVersion).trim(),
    machineMode: String(merged.machineMode ?? "").toLowerCase() === "device" ? "device" : "account",
  };
}

export const DeepAICodePlugin = async (input = {}, options = {}) => {
  const opts = resolveOptions(input, options);
  const lang = resolveLang(opts);
  const catalogCache = createCatalogCache();
  const state = { lastPoolWithQuota: null, lastRefreshAt: new Map() };
  const fetchImpl = globalThis.fetch;

  const log = async (level, message) => {
    try {
      await input?.client?.app?.log?.({ body: { service: "magpie-deepaicode", level, message } });
    } catch {
      // 日志不可用时不影响主流程
    }
    if (opts.debug) console.error(`[magpie-deepaicode] ${level}: ${message}`);
  };

  /** 拉目录：网关 /v1/models 或上游 /deepai_code/models，按账号模式。 */
  async function loadCatalog(settings) {
    const cacheKey = `${settings.mode}|${settings.mode === MODE_GATEWAY ? settings.url : settings.origin}`;
    return catalogCache.get(cacheKey, async () => {
      if (settings.mode === MODE_GATEWAY) {
        const payload = await getGatewayModels(settings.url, {
          key: settings.keyless ? "" : settings.key,
          fetchImpl,
        });
        const list = catalogFromGateway(payload);
        if (list.length === 0) throw new Error("gateway model catalog is empty");
        return list;
      }
      const payload = await getDirectModels(settings.origin, {
        machineFp: settings.machineFp,
        laneVersion: settings.laneVersion,
        fetchImpl,
      });
      const list = catalogFromDirect(payload);
      if (list.length === 0) throw new Error("upstream model catalog is empty");
      return list;
    });
  }

  const provider = {
    id: PROVIDER,
    async models(p, ctx = {}) {
      const auth = ctx?.auth;
      // 还没有账号时 magpie 也会问一次：直接给声明里的模型，别白跑一次网络探测。
      if (!auth) return { ...(p?.models ?? fallbackModels({})) };
      const settings = resolveAccountSettings(auth, opts);
      try {
        const list = await loadCatalog(settings);
        return modelsFromCatalog(list, p?.models ?? {});
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) {
          // 登录失效：让 magpie 标记账号，而不是把它当成“目录不可用”
          throw Object.assign(new Error(t(lang, "errSignInExpired")), { signIn: "expired" });
        }
        await log("warn", `catalog fallback (${settings.mode}): ${err?.status ?? ""} ${err?.message ?? err}`);
        const out = fallbackModels(p?.models ?? {});
        out[Symbol.for("magpie.fellBack")] = true;
        return out;
      }
    },
  };

  /** 额度：网关看池，直连看单号。 */
  async function usage(getAuth) {
    const auth = await getAuth();
    const settings = resolveAccountSettings(auth, opts);
    try {
      if (settings.mode === MODE_GATEWAY) {
        // 管理接口在“没设管理密码 + 回环”时也是开放的，所以先试再说；
        // 只有 401/403（确实需要密码）才降级为单号视角。
        try {
          const items = await getAccounts(settings.url, { admin: settings.admin, fetchImpl });
          const pool = aggregatePool(items);
          state.lastPoolWithQuota = pool.withQuota;
          return buildGatewayUsage({ pool, lang });
        } catch (err) {
          if (!(err instanceof HttpError && [401, 403].includes(err.status))) throw err;
          const payload = await getGatewayTheos(settings.url, {
            key: settings.keyless ? "" : settings.key,
            fetchImpl,
          });
          return buildGatewaySingleUsage({
            allowance: singleAllowance(payload),
            lang,
            note: t(lang, "usageNoAdmin"),
          });
        }
      }

      const [allowancePayload, summary] = await Promise.all([
        getDirectTheos(settings.origin, {
          key: settings.key,
          machineFp: settings.machineFp,
          laneVersion: settings.laneVersion,
          fetchImpl,
        }),
        getUsageSummary(settings.origin, {
          key: settings.key,
          machineFp: settings.machineFp,
          laneVersion: settings.laneVersion,
          fetchImpl,
        }).catch(() => null),
      ]);
      return buildDirectUsage({
        allowance: normalizeAllowance(allowancePayload),
        summary,
        username: settings.username,
        lang,
      });
    } catch (err) {
      return {
        error: describeError(err, { lang, mode: settings.mode, url: settings.url }),
        windows: [],
      };
    }
  }

  /** 签到：网关刷新全池；直连触发并锁定当日额度。 */
  async function checkin(getAuth) {
    const auth = await getAuth();
    const settings = resolveAccountSettings(auth, opts);
    try {
      if (settings.mode === MODE_GATEWAY) {
        let payload;
        try {
          payload = await postCheckin(settings.url, { admin: settings.admin, fetchImpl });
        } catch (err) {
          if (err instanceof HttpError && [401, 403].includes(err.status)) {
            return { outcome: "ineligible", message: t(lang, "usageNoAdmin") };
          }
          throw err;
        }
        const results = Array.isArray(payload?.results) ? payload.results : [];
        const out = buildGatewayCheckin({ results, prevWithQuota: state.lastPoolWithQuota, lang });
        state.lastPoolWithQuota = results.filter((r) => toNumber(r?.theos?.balance, 0) > 0).length;
        return out;
      }

      const payload = await getDirectTheos(settings.origin, {
        key: settings.key,
        machineFp: settings.machineFp,
        laneVersion: settings.laneVersion,
        fetchImpl,
      });
      const allowance = normalizeAllowance(payload);
      const accountId = String(auth?.accountId ?? "").trim()
        || accountIdFor({ mode: "direct", key: settings.key });
      const prev = state.lastRefreshAt.get(accountId) ?? "";
      const out = buildDirectCheckin({ allowance, prevRefreshAt: prev, lang });
      // 只有真正领到才推进基线；granted=0 时保留旧值，让当天稍后的重试能识别“刚领到”
      if (out.outcome !== "failed") {
        state.lastRefreshAt.set(accountId, String(allowance.rawRefreshAt ?? ""));
      }
      return out;
    } catch (err) {
      return { outcome: "failed", message: describeError(err, { lang, mode: settings.mode, url: settings.url }) };
    }
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {
        name: t(lang, "providerName"),
        npm: "@ai-sdk/openai-compatible",
        // 默认按插件默认模式给出；loader 会按账号的真实模式覆盖 baseURL。
        api: opts.mode === "direct" ? directBase(opts.baseOrigin) : `${trimSlash(opts.gatewayUrl)}/v1`,
        models: fallbackModels({}),
      };
    },

    auth: {
      provider: PROVIDER,
      methods: createMethods({ options: opts, deps: { fetchImpl } }),
      loader: async (getAuth) => createLoader(await getAuth(), opts, { fetchImpl }),
      usage,
      checkin,
    },

    provider,

    "chat.headers": async (hookInput, output) => {
      if (hookInput?.model?.providerID !== PROVIDER) return;
      Object.assign(output.headers, sessionAffinityHeaders(hookInput?.sessionID));
    },
  };
};

/** 单测与探针脚本用；不属于公开 API。 */
export const _internal = {
  resolveOptions,
  normalizeIncomingUrl,
  guardResponse,
  loaderTargets,
  modeOf,
  resolveAccountSettings,
  accountIdFor,
  LOOPBACK_KEY,
  aggregatePool,
  buildGatewayUsage,
  buildGatewaySingleUsage,
  buildDirectUsage,
  buildDirectCheckin,
  buildGatewayCheckin,
  catalogFromDirect,
  catalogFromGateway,
  modelsFromCatalog,
  fallbackModels,
  createMethods,
  findDesktopCredentials,
  startCallbackServer,
  detectDeviceRaw,
  machineFingerprint,
  accountMachineId,
  uuidV5,
  parseUuid,
  sha256Hex,
  describeError,
  formatNumber,
  isZeroCost,
  parseResetTime,
  toNumber,
  trimSlash,
  ICON_DATA_URI,
  FALLBACK_SNAPSHOT_DATE,
};
