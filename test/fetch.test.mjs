import test from "node:test";
import assert from "node:assert/strict";

import { createLoader, guardResponse, normalizeIncomingUrl } from "../src/fetch.mjs";
import { resolveAccountSettings } from "../src/modes.mjs";

const CHAT = "/chat/completions";
const FAKE_KEY = "fake-deepai-key-0001";

function directAuth() {
  return { type: "api", key: FAKE_KEY, metadata: { mode: "direct" } };
}

test("normalizeIncomingUrl：直连模式归一到 /deepai_code/{chat,responses}", () => {
  const settings = resolveAccountSettings(directAuth(), { baseOrigin: "https://api.deepai.org" });
  assert.equal(
    normalizeIncomingUrl("https://api.deepai.org/deepai_code" + CHAT, settings),
    "https://api.deepai.org/deepai_code" + CHAT,
  );
  // 重复的 /deepai_code（不同版本拼接行为不同的保险丝）
  assert.equal(
    normalizeIncomingUrl("https://api.deepai.org/deepai_code/deepai_code" + CHAT, settings),
    "https://api.deepai.org/deepai_code" + CHAT,
  );
  assert.equal(
    normalizeIncomingUrl("https://api.deepai.org/responses?beta=1", settings),
    "https://api.deepai.org/deepai_code/responses?beta=1",
  );
});

test("createLoader：直连 baseURL 与头（不带 apiKey/Authorization）", async () => {
  const direct = await createLoader(directAuth(), { laneVersion: "4" });
  assert.equal(direct.baseURL, "https://api.deepai.org/deepai_code");
  assert.equal(direct.apiKey, undefined);
  assert.equal(direct.headers["Api-Key"], directAuth().key);
  assert.equal(direct.headers["X-DeepAI-Code-Theos"], "4");
  assert.match(direct.headers["X-DeepAI-Code-Instance"], /^[0-9a-f]{32}$/);
  assert.ok(direct.headers["X-DeepAI-Code-Machine"]);
  assert.equal(direct.headers.Authorization, undefined);
});

test("loader.fetch：直连注入 Api-Key / 车道 / 机器指纹", async () => {
  let captured = null;
  const loader = await createLoader(directAuth(), { laneVersion: "4" }, {
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers };
      return new Response("{}", { status: 200 });
    },
  });
  await loader.fetch("https://api.deepai.org/deepai_code/responses", { method: "POST" });
  assert.equal(captured.url, "https://api.deepai.org/deepai_code/responses");
  assert.equal(captured.headers.get("api-key"), directAuth().key);
  assert.equal(captured.headers.get("x-deepai-code-theos"), "4");
  assert.match(captured.headers.get("x-deepai-code-instance"), /^[0-9a-f]{32}$/);
  assert.equal(captured.headers.get("authorization"), null);
  assert.ok(captured.headers.get("x-deepai-code-machine"));
});

test("loader.fetch：目标 URL 一律从配置基地址重建（凭据不发往外域）", async () => {
  let captured = null;
  const loader = await createLoader(directAuth(), { baseOrigin: "https://api.deepai.org", laneVersion: "4" }, {
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers, redirect: init.redirect };
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await loader.fetch("https://evil.example.com/v1" + CHAT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(captured.url, "https://api.deepai.org/deepai_code" + CHAT);
  assert.equal(captured.headers.get("api-key"), directAuth().key);
  assert.equal(captured.redirect, "error");
});

test("guardResponse：409 session_busy → 429，Retry-After 夹到 30s", async () => {
  const res = await guardResponse(
    new Response('{"error":{"code":"session_busy"}}', {
      status: 409,
      headers: { "content-type": "application/json", "retry-after": "120" },
    }),
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "30");
  assert.match(await res.text(), /session_busy/);
});

test("guardResponse：403 email_unverified 标记登录失效", async () => {
  const res = await guardResponse(
    new Response('{"error":{"code":"email_unverified"}}', {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("x-magpie-sign-in"), "expired");
});

test("loader.fetch：302（redirect:error）→ 401 且文案可读", async () => {
  const loader = await createLoader(directAuth(), { laneVersion: "4" }, {
    fetchImpl: async () => {
      throw new TypeError("fetch failed: unexpected redirect");
    },
  });
  const res = await loader.fetch("https://api.deepai.org/deepai_code" + CHAT, { method: "POST" });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error.message.length > 0);
});
