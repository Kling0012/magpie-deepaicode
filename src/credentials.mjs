// 桌面端凭据读取。
//
// DeepAI Code 桌面端登录后把凭据写成明文 JSON：
//   <base>/userdata/secrets/deepai-account.bin
//   {"apiKey":"…","username":"…","isPro":false}
//
// base 的探测顺序与参考实现一致：T3CODE_HOME → DEEPAI_CODE_HOME → ~/.deepai-code。
// 用户显式给了目录/文件时优先用显式值。

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { CREDENTIAL_FILES, SECRET_SUBDIRS } from "./constants.mjs";

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** 桌面端 base 目录候选。 */
export function desktopBaseDirs({ env = process.env, home = homedir() } = {}) {
  const out = [];
  for (const name of ["T3CODE_HOME", "DEEPAI_CODE_HOME"]) {
    const v = String(env?.[name] ?? "").trim();
    if (v) out.push(v);
  }
  out.push(join(home, ".deepai-code"));
  return dedupe(out);
}

/** 把 base 展开成可能含 secrets 的目录（去重）。 */
export function desktopSecretDirs(base) {
  if (!nonEmpty(base)) return [];
  const out = [];
  try {
    if (existsSync(base) && !statSync(base).isDirectory()) {
      out.push(dirname(base));
      return out;
    }
  } catch {
    // 忽略：后面按目录处理
  }
  for (const parts of SECRET_SUBDIRS) out.push(join(base, ...parts));
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const key = p.toLowerCase().replace(/[\\/]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function defaultIo() {
  return {
    exists: (p) => existsSync(p),
    isFile: (p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    },
    read: (p) => readFileSync(p, "utf8"),
  };
}

/** 校验并返回凭据对象；不合法时抛错（错误信息不含 Key）。 */
export function parseCredentials(raw, path = "") {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`bad-json: ${err?.message ?? "invalid JSON"}`);
  }
  const apiKey = String(data?.apiKey ?? "").trim();
  if (!apiKey) throw new Error("missing-api-key");
  if (apiKey.length > 512 || /[\s]/.test(apiKey)) throw new Error("invalid-api-key");
  return {
    apiKey,
    username: String(data?.username ?? "").trim(),
    isPro: Boolean(data?.isPro),
    path,
  };
}

/**
 * 找凭据。
 *
 * @returns {{ok: true, cred: object} | {ok: false, tried: string[], reason?: string, path?: string}}
 */
export function findDesktopCredentials({ explicit = "", env = process.env, home = homedir(), io = defaultIo() } = {}) {
  const tried = [];
  const explicitPath = String(explicit ?? "").trim();

  // 显式指向文件：优先读它
  if (explicitPath && io.isFile(explicitPath)) {
    tried.push(explicitPath);
    try {
      return { ok: true, cred: parseCredentials(io.read(explicitPath), explicitPath) };
    } catch (err) {
      return { ok: false, tried, path: explicitPath, reason: String(err?.message ?? err) };
    }
  }

  const bases = explicitPath ? [explicitPath] : desktopBaseDirs({ env, home });
  const lastError = { path: "", reason: "" };
  for (const base of bases) {
    for (const dir of desktopSecretDirs(base)) {
      for (const name of CREDENTIAL_FILES) {
        const path = join(dir, name);
        tried.push(path);
        if (!io.isFile(path)) continue;
        try {
          return { ok: true, cred: parseCredentials(io.read(path), path) };
        } catch (err) {
          lastError.path = path;
          lastError.reason = String(err?.message ?? err);
        }
      }
    }
  }
  if (lastError.path) return { ok: false, tried, path: lastError.path, reason: lastError.reason };
  return { ok: false, tried };
}

export { defaultIo };
