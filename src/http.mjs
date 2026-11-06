// 极简 HTTP 层：JSON 请求 + 结构化错误。
//
// 只服务于插件自己的旁路调用（模型目录、额度、签到、登录换码）。
// 推理请求不走这里：那是 fetch.mjs 的流式透传。

import { MAX_JSON_BYTES } from "./constants.mjs";

export class HttpError extends Error {
  constructor({ op, status, body = "" }) {
    const info = parseErrorPayload(body);
    super(`${op || "request"} → HTTP ${status}${info.message ? `: ${info.message}` : ""}`);
    this.name = "HttpError";
    this.op = op;
    this.status = status;
    this.body = body;
    this.upstream = info;
  }

  get code() {
    return this.upstream?.code ?? "";
  }
}

/** 解析两种错误体：OpenAI 风格 {error:{message,type,code}} 与纯文本。 */
export function parseErrorPayload(body, contentType = "") {
  const text = String(body ?? "").slice(0, 400);
  try {
    const data = JSON.parse(String(body ?? ""));
    const error = data?.error;
    if (error && typeof error === "object") {
      return {
        message: String(error.message ?? error.code ?? "").trim(),
        type: String(error.type ?? "").trim(),
        code: String(error.code ?? "").trim(),
      };
    }
    if (typeof error === "string") return { message: error, type: "", code: "" };
    if (typeof data?.message === "string") return { message: data.message, type: "", code: "" };
  } catch {
    // 不是 JSON：按文本处理
  }
  return { message: text.trim(), type: contentType, code: "" };
}

/**
 * 发一个 JSON 请求并返回解析后的对象；非 2xx 抛 HttpError。
 * 超时默认 15s；所有请求禁止跟随重定向（无效 Key 会 302 到登录页）。
 */
export async function fetchJson(
  url,
  {
    method = "GET",
    headers = {},
    body,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    signal,
  } = {},
) {
  const finalHeaders = { Accept: "application/json", ...headers };
  const init = { method, headers: finalHeaders, redirect: "error" };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!finalHeaders["Content-Type"]) finalHeaders["Content-Type"] = "application/json";
  }
  init.signal = signal ?? AbortSignal.timeout(timeoutMs);

  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError({
      op: `${method} ${url}`,
      status: res.status,
      body: text.slice(0, MAX_JSON_BYTES),
      contentType: res.headers.get("content-type") ?? "",
    });
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON from ${url}: ${err?.message ?? err}`);
  }
}

/** 发请求但只读文本（供 HTML 回调页这类场景）。 */
export async function fetchText(url, { method = "GET", headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError({ op: `${method} ${url}`, status: res.status, body: text });
  return text;
}
