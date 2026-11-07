// 直连模式：api.deepai.org 的额度与登录换码。
//
// 请求头要点（源码级，见 PROTOCOL.md）：
//   Api-Key                    ← 鉴权走这个头，不是 Authorization
//   X-DeepAI-Code-Theos        ← 车道版本，默认 "2"，不对会 426
//   X-DeepAI-Code-Machine      ← sha256(小写原始 UUID)，每日免费额度的分配键
//
// 额外坑：无效 Key 会 302 到登录页 → 所有请求都要 redirect: "error"。

import { fetchJson } from "./http.mjs";
import {
  DEFAULT_BASE_ORIGIN,
  DEFAULT_LANE_VERSION,
  HEADER_BEACON,
  HEADER_INSTANCE,
  HEADER_KEY,
  HEADER_LANE,
  HEADER_MACHINE,
  USER_AGENT,
  VERSION,
} from "./constants.mjs";
import { randomBytes } from "node:crypto";
import { parseResetTime, trimSlash } from "./util.mjs";

export function directOrigin(origin) {
  return trimSlash(origin || DEFAULT_BASE_ORIGIN);
}

/** 直连模式的基地址：magpie 会再拼 /chat/completions 或 /responses。 */
export function directBase(origin) {
  return `${directOrigin(origin)}/deepai_code`;
}

/** 客户端实例 id：与桌面端一致，每进程随机 32 hex；lane 4 的客户端身份头（缺失会 400）。 */
let cachedInstanceId = "";
export function instanceId() {
  cachedInstanceId ||= randomBytes(16).toString("hex");
  return cachedInstanceId;
}

/** /theos 必带的信标（桌面端每次都发）：v=版本;up=运行秒数;pi;focus。 */
export function beaconValue({ version = VERSION, uptime = process.uptime(), piActive = false, focused = true } = {}) {
  return `v=${version};up=${Math.floor(uptime)};pi=${piActive ? 1 : 0};focus=${focused ? 1 : 0}`;
}

/**
 * 上游请求头（不带 Authorization，也不冒充桌面端 UA）。
 * User-Agent 必须显式设置：Node 宿主的 undici fetch 默认发 "user-agent: node"，
 * 上游 WAF 对 /chat/completions 直接 400 "This request is not one DeepAI Code sends."（2026-11-07 实测）。
 */
export function directHeaders({ key = "", machineFp = "", laneVersion = DEFAULT_LANE_VERSION } = {}) {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  if (key) headers[HEADER_KEY] = String(key);
  headers[HEADER_LANE] = String(laneVersion || DEFAULT_LANE_VERSION);
  headers[HEADER_INSTANCE] = instanceId();
  if (machineFp) headers[HEADER_MACHINE] = String(machineFp);
  return headers;
}

/** GET /deepai_code/models（免鉴权；只需要车道头与机器指纹）。 */
export async function getDirectModels(
  origin,
  { machineFp = "", laneVersion = DEFAULT_LANE_VERSION, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {},
) {
  return fetchJson(`${directBase(origin)}/models`, {
    fetchImpl,
    headers: directHeaders({ machineFp, laneVersion }),
    timeoutMs,
  });
}

/** GET /deepai_code/theos → 账号的免费额度/余额（balance/granted 是字符串）。 */
export async function getTheos(
  origin,
  { key, machineFp = "", laneVersion = DEFAULT_LANE_VERSION, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {},
) {
  const headers = directHeaders({ key, machineFp, laneVersion });
  // 桌面端的 /theos 每次都带信标头（lane 4 客户端身份的一部分）。
  headers[HEADER_BEACON] = beaconValue();
  return fetchJson(`${directBase(origin)}/theos`, {
    fetchImpl,
    headers,
    timeoutMs,
  });
}

/** GET /get_usage_summary（根路径，不在 /deepai_code 下）。 */
export async function getUsageSummary(
  origin,
  { key, machineFp = "", laneVersion = DEFAULT_LANE_VERSION, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {},
) {
  const headers = directHeaders({ key, machineFp, laneVersion });
  // 参考实现查用量时用 UA "DeepAI-Code"；我们保持自己的可辨识 UA，避免冒充桌面端。
  return fetchJson(`${directOrigin(origin)}/get_usage_summary`, { fetchImpl, headers, timeoutMs });
}

/** 归一化 /theos 响应。 */
export function normalizeAllowance(payload = {}) {
  return {
    enabled: Boolean(payload?.enabled),
    balance: String(payload?.balance ?? ""),
    granted: String(payload?.granted ?? ""),
    refreshAt: parseResetTime(payload?.refresh_at),
    rawRefreshAt: payload?.refresh_at ?? "",
    laneVersion: payload?.lane_version ?? null,
  };
}

/**
 * 用桌面端登录回调里的 code 换 API Key。
 * 响应：{api_key, username, is_pro}。
 */
export async function exchangeCode(
  origin,
  code,
  { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {},
) {
  const value = String(code ?? "").trim();
  if (!value) throw new Error("empty-code");
  const payload = await fetchJson(`${directBase(origin)}/desktop_auth/exchange/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { code: value },
    fetchImpl,
    timeoutMs,
  });
  const apiKey = String(payload?.api_key ?? "").trim();
  if (!apiKey || /\s/.test(apiKey)) throw new Error("invalid-exchange-response");
  return {
    apiKey,
    username: String(payload?.username ?? "").trim(),
    isPro: Boolean(payload?.is_pro),
  };
}
