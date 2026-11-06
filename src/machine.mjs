// 机器指纹。
//
// 上游按 (X-DeepAI-Code-Machine, 账号) 每天发一次免费 Theos：
//   - 多个账号共用同一个指纹时，只有第一个能领到（参考实现实测）；
//   - 因此默认给每个账号派生一个独立、稳定的指纹。
//
// 指纹 = sha256(小写原始 UUID)，与桌面端/参考实现一致；原始值不上传。

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** RFC 4122 URL 命名空间（我们只借用它的字节，不要求外部可复算）。 */
const V5_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/** 固件占位 UUID：不能作为稳定标识。 */
const PLACEHOLDER_UUIDS = new Set([
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "03000200-0400-0500-0006-000700080009",
]);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/** 上游要求的指纹形态：sha256(小写去空白的原始值)；空串返回空串。 */
export function machineFingerprint(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  return sha256Hex(v);
}

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b) {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 v5 UUID（SHA-1）。确定性：同一 name 永远同一值。 */
export function uuidV5(name, namespace = V5_NAMESPACE) {
  const ns = uuidToBytes(namespace);
  const nameBytes = Buffer.from(String(name), "utf8");
  const hash = createHash("sha1").update(Buffer.concat([Buffer.from(ns), nameBytes])).digest();
  const b = new Uint8Array(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

/**
 * 账号级机器指纹：由 API Key 确定性派生。
 *
 * 为什么派生而不是随机存：重新登录同一 Key 时指纹不漂移，额度的归属不会丢；
 * 不同 Key 之间又互不干扰（避免“同机第二个号领不到当日额度”）。
 */
export function accountMachineId(apiKey) {
  const key = String(apiKey ?? "").trim();
  if (!key) return "";
  return uuidV5(sha256Hex(key));
}

/** 从任意文本中提取第一个非占位 UUID。 */
export function parseUuid(text) {
  const m = String(text ?? "").match(UUID_RE);
  if (!m) return "";
  const v = m[0].toLowerCase();
  return PLACEHOLDER_UUIDS.has(v) ? "" : v;
}

function run(cmd, args, timeout = 12_000) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout, windowsHide: true });
  } catch {
    return "";
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** 探测真实设备标识（原始 UUID / machine-id 文本）。失败返回空串。 */
export function detectDeviceRaw({
  platform = process.platform,
  run: runImpl = run,
  read: readImpl = readText,
  env = process.env,
} = {}) {
  const override = String(env?.DEEPAI_MACHINE_ID ?? "").trim();
  if (override) return override;

  if (platform === "win32") {
    const fromWmi = parseUuid(
      runImpl("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
      ]),
    );
    if (fromWmi) return fromWmi;
    const reg = runImpl("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
    const m = String(reg).match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    return m ? m[1].toLowerCase() : "";
  }

  if (platform === "darwin") {
    const out = runImpl("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    const m = String(out).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return m ? parseUuid(m[1]) : "";
  }

  // linux / 其他 unix
  for (const path of ["/sys/class/dmi/id/product_uuid", "/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    const raw = String(readImpl(path) ?? "").trim();
    if (!raw) continue;
    const uuid = parseUuid(raw);
    if (uuid) return uuid;
    return raw.toLowerCase();
  }
  return "";
}

/** 解析本次请求应使用的机器指纹（原始值 → sha256）。 */
export function resolveMachineFingerprint({ apiKey, machineMode = "account" } = {}) {
  if (machineMode === "device") {
    return machineFingerprint(detectDeviceRaw());
  }
  return machineFingerprint(accountMachineId(apiKey));
}
