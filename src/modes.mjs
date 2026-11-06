// 账号设置解析：一个 magpie 账号 → 用哪种模式、哪个地址、哪份凭据。

import {
  DEFAULT_BASE_ORIGIN,
  DEFAULT_GATEWAY_URL,
  DEFAULT_LANE_VERSION,
} from "./constants.mjs";
import { resolveMachineFingerprint } from "./machine.mjs";
import { sha256Hex } from "./machine.mjs";
import { trimSlash } from "./util.mjs";

export const MODE_GATEWAY = "gateway";
export const MODE_DIRECT = "direct";
/** 网关未签发密钥时保存的占位 Key（发出去也无害：回环放行）。 */
export const LOOPBACK_KEY = "loopback";

export function normalizeMode(value) {
  return String(value ?? "").trim().toLowerCase() === MODE_DIRECT ? MODE_DIRECT : MODE_GATEWAY;
}

export function modeOf(auth, options = {}) {
  return normalizeMode(auth?.metadata?.mode ?? options.mode);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url ?? "").replace(/^https?:\/\//, "");
  }
}

/**
 * 解析一个账号的最终设置。
 *
 * 优先级：auth.metadata（登录时写入） > options（插件选项） > 默认值。
 */
export function resolveAccountSettings(auth, options = {}) {
  const mode = modeOf(auth, options);
  const metadata = auth?.metadata ?? {};

  const url = trimSlash(metadata.url || options.gatewayUrl || DEFAULT_GATEWAY_URL);
  const origin = trimSlash(options.baseOrigin || DEFAULT_BASE_ORIGIN);

  const key = String(auth?.key ?? "").trim()
    || (mode === MODE_GATEWAY ? String(options.gatewayKey ?? "").trim() : "");

  const admin = String(metadata.admin ?? "").trim() || String(options.gatewayAdmin ?? "").trim();
  const laneVersion = String(metadata.laneVersion ?? options.laneVersion ?? DEFAULT_LANE_VERSION).trim()
    || DEFAULT_LANE_VERSION;
  const machineMode = String(metadata.machineMode ?? options.machineMode ?? "account") === "device" ? "device" : "account";
  const machineFp = mode === MODE_DIRECT
    ? resolveMachineFingerprint({ apiKey: key, machineMode })
    : "";

  const username = String(metadata.username ?? "").trim();
  const keyless = mode === MODE_GATEWAY && (Boolean(metadata.keyless) || key === LOOPBACK_KEY || key === "");

  return {
    mode,
    url,
    origin,
    key,
    admin,
    adminConfigured: admin !== "",
    laneVersion,
    machineMode,
    machineFp,
    username,
    keyless,
  };
}

/** 稳定账号 id：同 Key 重登 = 替换而不是新增。 */
export function accountIdFor({ mode, url = "", origin = "", key = "" }) {
  const finger = sha256Hex(key || LOOPBACK_KEY).slice(0, 16);
  if (normalizeMode(mode) === MODE_DIRECT) return `deepai:${finger}`;
  return `gw:${hostOf(url || origin)}:${finger}`;
}

/** 不允许把凭据发往任意外域：推理请求的目标必须是这两个之一。 */
export function assertAllowedTarget(targetUrl, settings) {
  const allowed = settings.mode === MODE_GATEWAY
    ? [settings.url]
    : [settings.origin];
  const normalized = trimSlash(targetUrl);
  return allowed.some((base) => normalized.startsWith(trimSlash(base)));
}
