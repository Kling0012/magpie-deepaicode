import test from "node:test";
import assert from "node:assert/strict";

import { createLoader, guardResponse, normalizeIncomingUrl } from "../src/fetch.mjs";
import { resolveAccountSettings } from "../src/modes.mjs";

const CHAT = "/chat/completions";
const FAKE_KEY = "fake-deepai-key-0001";

function gatewayAuth(overrides = {}) {
  return {
    type: "api",
    key: "sk-gw",
    metadata: { mode: "gateway", url: "http://127.0.0.1:10087", ...overrides },
  };
}

function directAuth() {
  return { type: "api", key: FAKE_KEY, metadata: { mode: "direct" } };
}

test("normalizeIncomingUrl：网关模式归一到 /v1/{chat,responses}", () => {
  const settings = resolveAccountSettings(gatewayAuth(), {});
  assert.equal(
    normalizeIncomingUrl("http://127.0.0.1:10087/v1" + CHAT, settings),
    "http://127.0.0.1:10087/v1" + CHAT,
  );
  // 重复的 /v1（不同版本拼接行为不同的保险丝）
  assert.equal(
    normalizeIncomingUrl("http://127.0.0.1:10087/v1/v1" + CHAT, settings),
    "http://127.0.0.1:10087/v1" + CHAT,
  );
  assert.equal(
    normalizeIncomingUrl("http://127.0.0.1:10087/v1/responses", settings),
    "http://127.0.0.1:10087/v1/responses",
  );
});

test("normalizeIncomingUrl：直连模式归一到 /deepai_code/{chat,responses}", () => {
  const settings = resolveAccountSettings(directAuth(), { baseOrigin: "https://api.deepai.org" });
  assert.equal(
    normalizeIncomingUrl("https://api.deepai.org/deepai_code" + CHAT, settings),
    "https://api.deepai.org/deepai_code" + CHAT,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.deepai.org/responses?beta=1", settings),
    "https://api.deepai.org/deepai_code/responses?beta=1",
  );
});

test("createLoader：网关返回 baseURL/apiKey，直连不带 apiKey", () => {
  const gw = createLoader(gatewayAuth(), {});
  assert.equal(gw.baseURL, "http://127.0.0.1:10087/v1");
  assert.equal(gw.apiKey, "sk-gw");
  assert.equal(gw.headers.Authorization, "Bearer sk-gw");

  const direct = createLoader(directAuth(), {});
  assert.equal(direct.baseURL, "https://api.deepai.org/deepai_code");
  assert.equal(direct.apiKey, undefined);
  assert.equal(direct.headers["Api-Key"], directAuth().key);
  assert.equal(direct.headers["X-DeepAI-Code-Theos"], "2");
  assert.ok(direct.headers["X-DeepAI-Code-Machine"]);
});

test("createLoader：无 Key 的网关不带 Authorization", () => {
  const loader = createLoader(
    { type: "api", key: "loopback", metadata: { mode: "gateway", url: "http://127.0.0.1:10087", keyless: true } },
    {},
  );
  assert.equal(loader.apiKey, undefined);
  assert.equal(loader.headers.Authorization, undefined);
});

test("loader.fetch：目标 URL 与头被注入（网关）", async () => {
  let captured = null;
  const loader = createLoader(gatewayAuth(), {}, {
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers, redirect: init.redirect };
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await loader.fetch("http://127.0.0.1:10087/v1" + CHAT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(captured.url, "http://127.0.0.1:10087/v1" + CHAT);
  assert.equal(captured.headers.get("authorization"), "Bearer sk-gw");
  assert.equal(captured.headers.get("content-type"), "application/json");
  assert.equal(captured.redirect, "error");
});

test("loader.fetch：直连注入 Api-Key / 车道 / 机器指纹", async () => {
  let captured = null;
  const loader = createLoader(directAuth(), {}, {
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers };
      return new Response("{}", { status: 200 });
    },
  });
  await loader.fetch("https://api.deepai.org/deepai_code/responses", { method: "POST" });
  assert.equal(captured.url, "https://api.deepai.org/deepai_code/responses");
  assert.equal(captured.headers.get("api-key"), directAuth().key);
  assert.equal(captured.headers.get("x-deepai-code-theos"), "2");
  assert.equal(captured.headers.get("authorization"), null);
  assert.ok(captured.headers.get("x-deepai-code-machine"));
});

test("guardResponse：409 session_busy → 429，Retry-After 夹到 30s", async () => {
  const settings = resolveAccountSettings(directAuth(), {});
  const res = await guardResponse(
    new Response('{"error":{"code":"session_busy"}}', {
      status: 409,
      headers: { "content-type": "application/json", "retry-after": "120" },
    }),
    settings,
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "30");
  assert.match(await res.text(), /session_busy/);
});

test("guardResponse：403 email_unverified 标记登录失效", async () => {
  const settings = resolveAccountSettings(directAuth(), {});
  const res = await guardResponse(
    new Response('{"error":{"code":"email_unverified"}}', {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    settings,
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("x-magpie-sign-in"), "expired");
});

test("guardResponse：网关 503 池空 → 429；setup_required 保持 503", async () => {
  const settings = resolveAccountSettings(gatewayAuth(), {});
  const empty = await guardResponse(
    new Response('{"error":{"message":"没有可用账号"}}', { status: 503, headers: { "content-type": "application/json" } }),
    settings,
  );
  assert.equal(empty.status, 429);

  const setup = await guardResponse(
    new Response('{"error":{"type":"setup_required"}}', { status: 503, headers: { "content-type": "application/json" } }),
    settings,
  );
  assert.equal(setup.status, 503);
});

test("loader.fetch：302（redirect:error）→ 401 且文案可读", async () => {
  const loader = createLoader(directAuth(), {}, {
    fetchImpl: async () => {
      throw new TypeError("fetch failed: unexpected redirect");
    },
  });
  const res = await loader.fetch("https://api.deepai.org/deepai_code" + CHAT, { method: "POST" });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error.message.length > 0);
});

test("loader.fetch：网关连不上 → 503 且提示网关地址", async () => {
  const loader = createLoader(gatewayAuth(), {}, {
    fetchImpl: async () => {
      throw new Error("Failed to connect to 127.0.0.1:10087");
    },
  });
  const res = await loader.fetch("http://127.0.0.1:10087/v1" + CHAT, { method: "POST" });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error.message, /127\.0\.0\.1:10087/);
});
