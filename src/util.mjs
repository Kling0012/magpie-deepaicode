// 通用工具（纯函数，方便单测）。

import { t } from "./i18n.mjs";

/** 去掉首尾空白与末尾斜杠。 */
export function trimSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

/** 上游/网关的数值常是字符串（"200.00000"），统一转数字；不认识返回 fallback。 */
export function toNumber(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

/** 展示用数字：去掉 5 位小数尾巴（2400.00000 → 2400）。 */
export function formatNumber(value) {
  const n = toNumber(value, NaN);
  if (!Number.isFinite(n)) return String(value ?? "");
  const fixed = Number(n.toFixed(5));
  return String(fixed);
}

/** theosPerRequest 是否为 0（"0" / "0.0" / "0.00"）。 */
export function isZeroCost(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return /^0(\.0+)?$/.test(raw);
}

/**
 * 把 ISO 字符串 / 秒 / 毫秒时间戳统一成 ISO 字符串；不认识返回 undefined。
 * magpie 的 windows 接受 ISO、秒、毫秒三种写法，这里统一成 ISO 最稳。
 */
export function parseResetTime(value) {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return parseResetTime(n > 1e12 ? n : n * 1000);
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 把错误变成用户能看懂的一句话（不泄露 Key）。 */
export function describeError(err, { lang = "zh", mode = "gateway", url = "" } = {}) {
  const status = Number(err?.status ?? 0);
  const raw = String(err?.message ?? err ?? "");

  if (status === 401) return t(lang, "errGatewayUnauthorized");
  if (status === 503 && /setup_required|尚未签发/.test(raw)) {
    return t(lang, "errGatewaySetupRequired", { url });
  }
  if (status === 426) return t(lang, "errLane");
  if (status === 429) return mode === "gateway" ? t(lang, "errPoolEmpty") : t(lang, "errLane");
  if (/redirect/i.test(raw)) return t(lang, "errRedirect");
  if (/ECONNREFUSED|Failed to connect|connection refused|could not connect|fetch failed/i.test(raw)) {
    return mode === "gateway" ? t(lang, "errGatewayDown", { url }) : raw;
  }
  if (/timeout|timed out|AbortError/i.test(raw)) return t(lang, "errTimeout");
  return raw || t(lang, "errSignInExpired");
}
