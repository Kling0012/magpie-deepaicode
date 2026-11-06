// 推理请求链路：loader 的 fetch。
//
// magpie 的网关已经把任意 Agent 协议转成了 Chat Completions / Responses，
// 并决定基地址（loader.baseURL）。插件要做的只有四件事：
//   1. 注入上游/网关要求的头（Api-Key / Theos 车道 / 机器指纹 / Bearer）；
//   2. 把路径归一到目标端点（不依赖网关拼接行为的“保险丝”）；
//   3. 错误语义映射（409/503 → 429、403 email_unverified → 标记登录失效、302 → 401）；
//   4. 原样流式透传（不缓冲，不改内容）。

import {
  DEFAULT_LANE_VERSION,
  HEADER_AFFINITY,
  HEADER_MACHINE,
  RETRY_AFTER_CAP_S,
} from "./constants.mjs";
import { directBase, directHeaders } from "./direct.mjs";
import { gatewayApiBase, gatewayAuthHeaders } from "./gateway.mjs";
import { t, resolveLang } from "./i18n.mjs";
import { resolveAccountSettings, MODE_GATEWAY } from "./modes.mjs";

const CHAT_SUFFIX = "/chat/completions";
const RESPONSES_SUFFIX = "/responses";

/** 目标基地址（magpie 会拼 /chat/completions 或 /responses，但我们自己重写）。 */
export function loaderTargets(settings) {
  const baseURL = settings.mode === MODE_GATEWAY
    ? gatewayApiBase(settings.url)
    : directBase(settings.origin);
  return { baseURL, chatSuffix: CHAT_SUFFIX, responsesSuffix: RESPONSES_SUFFIX };
}

/**
 * 把 magpie 给的 URL 归一到目标端点。
 *
 * magpie 传给插件时通常已是 {baseURL}/chat/completions；但不同版本/不同 npm 包
 * 的拼接方式不一定一致（也可能重复带 /v1）。这里只认路径尾巴：
 *   .../responses  → Responses 端点
 *   其它           → Chat Completions 端点
 * 查询串原样保留（例如 ?alt=sse）。
 */
export function normalizeIncomingUrl(input, settings) {
  const raw = typeof input === "string" ? input : input?.url ?? String(input ?? "");
  let pathname = "";
  let search = "";
  try {
    const url = new URL(raw);
    pathname = url.pathname;
    search = url.search;
  } catch {
    pathname = raw;
  }
  const suffix = /\/responses\s*$/i.test(pathname) ? RESPONSES_SUFFIX : CHAT_SUFFIX;
  const base = loaderTargets(settings).baseURL;
  return `${base}${suffix}${search}`;
}

/** 每个请求要带的头（其余交给 magpie 的 init.headers）。 */
export function modeHeaders(settings) {
  if (settings.mode === MODE_GATEWAY) {
    return settings.keyless ? {} : gatewayAuthHeaders({ key: settings.key });
  }
  return directHeaders({
    key: settings.key,
    machineFp: settings.machineFp,
    laneVersion: settings.laneVersion || DEFAULT_LANE_VERSION,
  });
}

function clampRetryAfter(headers) {
  const raw = headers.get("retry-after");
  if (!raw) return;
  const secs = Number(String(raw).trim());
  if (!Number.isFinite(secs) || secs <= 0) return;
  if (secs > RETRY_AFTER_CAP_S) headers.set("retry-after", String(RETRY_AFTER_CAP_S));
}

/** 重建响应：改状态/加头时必须去掉与会话体相关的长度与编码头。 */
function rebuildResponse(res, { status = res.status, body = null, extraHeaders = {} } = {}) {
  const headers = new Headers(res.headers);
  for (const name of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(name);
  clampRetryAfter(headers);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(body, { status, statusText: res.statusText || "", headers });
}

function jsonError(status, message, type = "invalid_request_error") {
  return new Response(JSON.stringify({ error: { message, type, code: status } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * 错误语义映射（两模式按表写，见 PROTOCOL.md §6）。
 * 只在非 2xx 时调用；2xx 一律原样返回（流式体不碰）。
 */
export async function guardResponse(res, settings) {
  // 容量拒绝：magpie 只对 429/5xx 做账号故障转移，409 会直接落到 agent。
  if (res.status === 409) {
    const body = await res.text();
    return rebuildResponse(res, { status: 429, body });
  }

  if (res.status === 403) {
    const body = await res.text();
    const unverified = /email_unverified|邮箱未验证/i.test(body);
    return rebuildResponse(res, {
      body,
      extraHeaders: unverified ? { "X-Magpie-Sign-In": "expired" } : {},
    });
  }

  if (res.status === 503 && settings.mode === MODE_GATEWAY) {
    const body = await res.text();
    if (/没有可用账号|no available account|setup_required/i.test(body)) {
      // setup_required 保持 503（配置问题）；池空转 429（可换号）
      const status = /setup_required/i.test(body) ? 503 : 429;
      return rebuildResponse(res, { status, body });
    }
    return rebuildResponse(res, { body });
  }

  return res;
}

/**
 * 构造 loader。
 *
 * 本函数只做“准备”，真正的请求在 loader.fetch 里发。
 * 所有请求的 URL 都从配置的基地址重建，凭据只可能发往配置的网关/上游。
 */
export function createLoader(auth, options = {}, { fetchImpl = globalThis.fetch } = {}) {
  const settings = resolveAccountSettings(auth, options);
  const targets = loaderTargets(settings);
  const headers = modeHeaders(settings);
  const lang = resolveLang(options);

  const loader = {
    baseURL: targets.baseURL,
    // 交给 AI SDK 的 apiKey：只有网关确实有密钥时才给。
    // 直连模式上游只认 Api-Key 头，这里不设置，避免多带一个 Authorization。
    ...(settings.mode === MODE_GATEWAY && settings.key && !settings.keyless
      ? { apiKey: settings.key }
      : {}),
    headers,
    async fetch(input, init = {}) {
      // URL 一律从配置的基地址重建：magpie 传进来的主机/路径只用来判断
      // 是 chat 还是 responses，凭据永远不会被发往别的主机。
      const target = normalizeIncomingUrl(input, settings);

      const merged = new Headers(init?.headers ?? {});
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      if (settings.mode !== MODE_GATEWAY && settings.machineFp) {
        merged.set(HEADER_MACHINE, settings.machineFp);
      }

      let res;
      try {
        res = await fetchImpl(target, {
          ...init,
          headers: merged,
          redirect: "error", // 无效 Key 会 302 到登录页：绝不跟随
        });
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        const msg = String(err?.message ?? err);
        if (/redirect/i.test(msg)) return jsonError(401, t(lang, "errRedirect"));
        if (settings.mode === MODE_GATEWAY
          && /ECONNREFUSED|Failed to connect|connection refused|could not connect|fetch failed/i.test(msg)) {
          return jsonError(503, t(lang, "errGatewayDown", { url: settings.url }), "setup_required");
        }
        throw err; // 交给 magpie 的故障转移
      }

      return guardResponse(res, { ...settings, options });
    },
  };

  return loader;
}

/** chat.headers 钩子用：给直连请求带上会话粘性。 */
export function sessionAffinityHeaders(sessionId) {
  const value = String(sessionId ?? "").trim();
  return value ? { [HEADER_AFFINITY]: value } : {};
}
