// 网关模式：本机 DeepAICode2API 的读数与签到。
//
// 鉴权规则（源码级，见 PROTOCOL.md）：
//   - /health、/ping 免鉴权；
//   - /v1/* 走 withAuth：签发了密钥则强制校验（Authorization: Bearer / x-api-key），
//     未签发时仅回环放行，非回环 503 setup_required；
//   - /admin/api/* 走 withAdminAuth：设了管理密码必须带 X-Admin-Password，
//     没设则仅回环；写操作要同源（无 Origin 头视为同源）。

import { fetchJson } from "./http.mjs";
import { trimSlash, toNumber, parseResetTime } from "./util.mjs";
import { HEALTH_TIMEOUT_MS } from "./constants.mjs";

export function gatewayBase(url) {
  return trimSlash(url);
}

/** 数据面基地址（magpie 会再拼 /chat/completions 或 /responses）。 */
export function gatewayApiBase(url) {
  return `${gatewayBase(url)}/v1`;
}

export function gatewayAuthHeaders({ key } = {}) {
  const value = String(key ?? "").trim();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

export function gatewayAdminHeaders({ admin } = {}) {
  const value = String(admin ?? "").trim();
  return value ? { "X-Admin-Password": value } : {};
}

/** GET /health（免鉴权）——用来做“发现网关”的 UX。 */
export async function getHealth(url, { fetchImpl = globalThis.fetch, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  return fetchJson(`${gatewayBase(url)}/health`, { fetchImpl, timeoutMs });
}

/** GET /v1/models：既拿目录，也用来验证鉴权是否通过。 */
export async function getModels(url, { key = "", fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  return fetchJson(`${gatewayApiBase(url)}/models`, {
    fetchImpl,
    headers: gatewayAuthHeaders({ key }),
    timeoutMs,
  });
}

/** GET /admin/api/overview：账号数/就绪数/目录/上游地址等元信息。 */
export async function getOverview(url, { admin = "", fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  return fetchJson(`${gatewayBase(url)}/admin/api/overview`, {
    fetchImpl,
    headers: gatewayAdminHeaders({ admin }),
    timeoutMs,
  });
}

/**
 * GET /admin/api/accounts?offset&limit：分页拿账号（含每号的 theos）。
 * 账号池可能很大，这里最多翻 5 页（每页 500），再多就只统计前 2500 个。
 */
export async function getAccounts(
  url,
  { admin = "", limit = 500, maxPages = 5, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {},
) {
  const items = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchJson(
      `${gatewayBase(url)}/admin/api/accounts?offset=${offset}&limit=${limit}`,
      { fetchImpl, headers: gatewayAdminHeaders({ admin }), timeoutMs },
    );
    const batch = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...batch);
    const total = toNumber(payload?.total, items.length);
    offset += batch.length;
    if (batch.length === 0 || offset >= total) break;
  }
  return items;
}

/** POST /admin/api/checkin：刷新（可指定单个账号 id）额度。 */
export async function postCheckin(
  url,
  { admin = "", id = "", fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {},
) {
  return fetchJson(`${gatewayBase(url)}/admin/api/checkin`, {
    method: "POST",
    headers: gatewayAdminHeaders({ admin }),
    body: id ? { id } : {},
    fetchImpl,
    timeoutMs,
  });
}

/**
 * 把账号列表聚合成池级额度。
 * 注意：参考实现的 balance/granted 是字符串（"200.00000"），历史遗留也会是数字。
 */
export function aggregatePool(items = []) {
  const total = items.length;
  let enabled = 0;
  let withQuota = 0;
  let errored = 0;
  let sumBalance = 0;
  let sumGranted = 0;
  let earliestReset = "";

  for (const item of items) {
    const theos = item?.theos ?? null;
    const balance = toNumber(theos?.balance, 0);
    const granted = toNumber(theos?.granted, 0);

    if (item?.enabled !== false) enabled += 1;
    if (balance > 0) withQuota += 1;
    if (item?.status === "error" || String(item?.last_err ?? "").trim()) errored += 1;
    sumBalance += balance;
    sumGranted += granted;

    const reset = parseResetTime(theos?.refresh_at);
    if (reset && (!earliestReset || reset < earliestReset)) earliestReset = reset;
  }

  return {
    total,
    enabled,
    withQuota,
    errored,
    sumBalance,
    sumGranted,
    earliestResetAt: earliestReset || undefined,
  };
}

/** 单账号的额度（管理员密码缺失时的降级视角）。 */
export function singleAllowance(payload) {
  const theos = payload?.theos ?? payload ?? {};
  return {
    enabled: Boolean(theos.enabled),
    balance: String(theos.balance ?? ""),
    granted: String(theos.granted ?? ""),
    refreshAt: parseResetTime(theos.refresh_at),
    account: String(payload?.account ?? ""),
    username: String(payload?.username ?? ""),
  };
}

/** GET /v1/deepai/theos（数据面，单号视角）。 */
export async function getTheos(url, { key = "", fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  return fetchJson(`${gatewayApiBase(url)}/deepai/theos`, {
    fetchImpl,
    headers: gatewayAuthHeaders({ key }),
    timeoutMs,
  });
}
