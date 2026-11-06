// 最小网关桩：用于离线演示与“没有真网关”时的联调。
//
//   node scripts/mock-gateway.mjs --port 10099 [--key sk-demo] [--accounts 3]
//
// 实现的是插件实际用到的子集：
//   GET  /health                 免鉴权
//   GET  /v1/models              OpenAI list + deepai 元信息
//   POST /v1/{chat,responses}    流式/非流式假回复
//   GET  /v1/deepai/theos        单号额度
//   GET  /admin/api/overview     池元信息
//   GET  /admin/api/accounts     账号分页（带 theos）
//   POST /admin/api/checkin      刷新额度（假实现：每次把 granted 设为 200）
// 鉴权规则与真网关一致：没给 --key 时回环放行；给了就强制 Bearer。

import { createServer } from "node:http";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}

const PORT = Number(arg("port", "10099"));
const KEY = String(arg("key", ""));
const ACCOUNT_COUNT = Math.max(1, Number(arg("accounts", "3")));

const CATALOG = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", reasoning: true, input: ["text", "image"], context_window: 1048576, max_tokens: 131072, premier: false, free: true, api: "", theos_per_request: "0" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", reasoning: true, input: ["text", "image"], context_window: 1048576, max_tokens: 131072, premier: false, free: true, api: "", theos_per_request: "0" },
  { id: "gpt-6-astra", name: "GPT-6 Astra", reasoning: true, input: ["text", "image"], context_window: 1048576, max_tokens: 131072, premier: true, free: false, api: "openai-responses", theos_per_request: "50" },
];

const accounts = Array.from({ length: ACCOUNT_COUNT }, (_, i) => ({
  id: `acct-${i + 1}`,
  name: `demo-${i + 1}`,
  enabled: true,
  status: "ok",
  last_err: "",
  theos: { enabled: true, balance: "200.00000", granted: "200.00000", refresh_at: "2026-11-07T04:03:03Z", lane_version: 2 },
}));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!KEY) return true;
  const header = req.headers.authorization ?? req.headers["x-api-key"] ?? "";
  const token = String(header).replace(/^Bearer\s+/i, "").trim();
  return token === KEY;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/ping") {
    res.writeHead(200, { "content-type": "text/plain" }).end("pong");
    return;
  }

  if (path === "/health" || path === "/healthz") {
    return json(res, 200, {
      status: "ok",
      accounts: accounts.length,
      ready: accounts.filter((a) => a.enabled).length,
      models: CATALOG.length,
      default_model: CATALOG[0].id,
      machine_id: "mock0000",
      machine_ready: true,
    });
  }

  // 数据面鉴权
  if (path.startsWith("/v1/") && !authorized(req)) {
    return json(res, 401, { error: { message: "API 密钥无效或已停用", type: "invalid_request_error", code: 401 } });
  }

  if (path === "/v1/models" && req.method === "GET") {
    return json(res, 200, {
      object: "list",
      data: CATALOG.map((m) => ({
        id: m.id,
        object: "model",
        created: 1790000000,
        owned_by: "deepai",
        deepai: m,
      })),
    });
  }

  if (path === "/v1/deepai/theos" && req.method === "GET") {
    return json(res, 200, { account: accounts[0].id, username: "demo", theos: accounts[0].theos });
  }

  if (path === "/v1/deepai/usage" && req.method === "GET") {
    return json(res, 200, {
      account: accounts[0].id,
      username: "demo",
      usage: { is_pro: true, plan: "Pro", credits_remaining: 12.5, period_description: "monthly" },
    });
  }

  if ((path === "/v1/chat/completions" || path === "/v1/responses") && req.method === "POST") {
    const body = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(body); } catch { /* ignore */ }
    const model = payload.model || CATALOG[0].id;
    const stream = Boolean(payload.stream);
    const content = "mock reply: pong";
    if (!stream) {
      return json(res, 200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      });
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const first = { id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "mock " }, finish_reason: null }] };
    const second = { id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: "reply: pong" }, finish_reason: "stop" }] };
    const usage = { id: "chatcmpl-mock", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } };
    res.write(`data: ${JSON.stringify(first)}\n\n`);
    res.write(`data: ${JSON.stringify(second)}\n\n`);
    res.write(`data: ${JSON.stringify(usage)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // 管理面
  if (path.startsWith("/admin/api/")) {
    if (!authorized(req)) {
      return json(res, 401, { error: { message: "管理密码缺失或错误", type: "invalid_request_error", code: 401 } });
    }
    if (path === "/admin/api/overview") {
      return json(res, 200, {
        accounts: accounts.length,
        ready: accounts.filter((a) => a.enabled).length,
        models: CATALOG,
        default_model: CATALOG[0].id,
        machine_id: "mock0000",
        upstream: "https://api.deepai.org",
        stats: { requests: 0, errors: 0 },
      });
    }
    if (path === "/admin/api/accounts") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const items = accounts.slice(offset, offset + limit);
      return json(res, 200, { items, total: accounts.length, offset, limit });
    }
    if (path === "/admin/api/checkin" && req.method === "POST") {
      await readBody(req);
      const results = accounts.map((a) => {
        a.theos = { ...a.theos, balance: "200.00000", granted: "200.00000" };
        return { id: a.id, name: a.name, ok: true, err: "", theos: a.theos };
      });
      return json(res, 200, { ok: true, results });
    }
    return json(res, 404, { error: { message: "not found", code: 404 } });
  }

  json(res, 404, { error: { message: "not found", type: "invalid_request_error", code: 404 } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock gateway on http://127.0.0.1:${PORT} (key=${KEY ? "required" : "open"}, accounts=${ACCOUNT_COUNT})`);
});
