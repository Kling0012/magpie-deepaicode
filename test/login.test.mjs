import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMethods } from "../src/login.mjs";

const KEY = "fake-deepai-key-0001";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("createMethods：默认三路（浏览器推荐在前），网关隐藏", () => {
  const methods = createMethods({ options: { lang: "zh" }, deps: { fetchImpl: async () => json({}) } });
  assert.equal(methods.length, 3);
  assert.deepEqual(methods.map((m) => m.type), ["oauth", "api", "api"]);
  assert.match(methods[0].label, /推荐/);
  assert.match(methods[1].label, /凭据/);
  assert.match(methods[2].label, /Key/);
});

test("createMethods：showGatewayLogin 才出现网关方式（排最后）", () => {
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl: async () => json({}) } });
  assert.equal(methods.length, 4);
  assert.match(methods.at(-1).label, /网关/);
  assert.equal(methods.at(-1).prompts.length, 3);
});

test("网关登录：成功且 keyless（未签发密钥的网关）", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/health")) return json({ accounts: 2, ready: 1, models: 14 });
    if (url.endsWith("/v1/models")) return json({ object: "list", data: [] });
    throw new Error(`unexpected ${url}`);
  };
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });
  const out = await methods.at(-1).authorize({ url: "http://127.0.0.1:10087", key: "", admin: "pw", dir: "", username: "" });
  assert.equal(out.type, "success");
  assert.equal(out.key, "loopback");
  assert.equal(out.metadata.mode, "gateway");
  assert.equal(out.metadata.keyless, true);
  assert.equal(out.metadata.admin, "pw");
  assert.equal(out.metadata.discovered.models, 14);
  assert.match(out.accountId, /^gw:127\.0\.0\.1:10087:/);
});

test("网关登录：401 给出密钥提示", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/health")) return json({ accounts: 1 });
    if (url.endsWith("/v1/models")) return json({ error: { message: "API 密钥无效或已停用", code: 401 } }, 401);
    throw new Error("unexpected");
  };
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });
  const out = await methods.at(-1).authorize({ url: "http://127.0.0.1:10087", key: "bad" });
  assert.equal(out.type, "failed");
  assert.match(out.error, /网关拒绝了请求/);
});

test("网关登录：网关没起来给出地址提示", async () => {
  const fetchImpl = async () => {
    throw new Error("Failed to connect to 127.0.0.1:10087");
  };
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });
  const out = await methods.at(-1).authorize({ url: "http://127.0.0.1:10087" });
  assert.equal(out.type, "failed");
  assert.match(out.error, /127\.0\.0\.1:10087/);
});

test("桌面端登录：读文件 + /theos 验活", async () => {
  const base = mkdtempSync(join(tmpdir(), "deepaicode-login-"));
  mkdirSync(join(base, "userdata", "secrets"), { recursive: true });
  writeFileSync(
    join(base, "userdata", "secrets", "deepai-account.bin"),
    JSON.stringify({ apiKey: KEY, username: "ada", isPro: false }),
    "utf8",
  );

  const old = process.env.T3CODE_HOME;
  process.env.T3CODE_HOME = base;
  try {
    const fetchImpl = async (url) => {
      if (url.endsWith("/theos")) return json({ enabled: true, balance: "200.00000", granted: "200.00000" });
      throw new Error(`unexpected ${url}`);
    };
    const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });
    const out = await methods[1].authorize({ dir: "", key: "", keyInputs: "" });
    assert.equal(out.type, "success");
    assert.equal(out.key, KEY);
    assert.equal(out.metadata.mode, "direct");
    assert.equal(out.metadata.source, "desktop");
    assert.equal(out.metadata.username, "ada");
    assert.match(out.accountId, /^deepai:/);
  } finally {
    if (old === undefined) delete process.env.T3CODE_HOME;
    else process.env.T3CODE_HOME = old;
    rmSync(base, { recursive: true, force: true });
  }
});

test("桌面端登录：找不到凭据时列出尝试过的路径", async () => {
  const methods = createMethods({
    options: { lang: "zh", secretDir: "C:\\definitely-missing" },
    deps: { fetchImpl: async () => json({}) },
  });
  const out = await methods[1].authorize({ dir: "C:\\definitely-missing" });
  assert.equal(out.type, "failed");
  assert.match(out.error, /没有找到桌面端凭据/);
});

test("粘贴登录：缺 Key 失败；有 Key 成功", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/theos")) return json({ enabled: true, balance: "200", granted: "200" });
    throw new Error(`unexpected ${url}`);
  };
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });

  const missing = await methods[2].authorize({});
  assert.equal(missing.type, "failed");
  assert.match(missing.error, /缺少 DeepAI API Key/);

  const ok = await methods[2].authorize({ key: KEY, username: "ada" });
  assert.equal(ok.type, "success");
  assert.equal(ok.key, KEY);
  assert.equal(ok.metadata.username, "ada");
});

test("浏览器登录：本地回调收到 code 后换 Key", async () => {
  const fetchImpl = async (url, init) => {
    if (url.includes("/desktop_auth/exchange/")) {
      assert.deepEqual(JSON.parse(init.body), { code: "the-code" });
      return json({ api_key: KEY, username: "ada", is_pro: false });
    }
    throw new Error(`unexpected ${url}`);
  };
  const methods = createMethods({ options: { lang: "zh", showGatewayLogin: true }, deps: { fetchImpl } });
  const method = methods[0];

  const authz = await method.authorize({}, {});
  assert.equal(authz.method, "auto");

  const loginUrl = new URL(authz.url);
  assert.equal(loginUrl.pathname, "/deepai_code/desktop_auth/");
  const state = loginUrl.searchParams.get("state");
  const port = Number(loginUrl.searchParams.get("port"));
  assert.ok(port > 0);
  assert.ok(state.length >= 16);

  const callback = await fetch(`http://127.0.0.1:${port}/auth-callback?code=the-code&state=${state}`);
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /登录完成|Signed in/);

  const out = await authz.callback();
  assert.equal(out.type, "success");
  assert.equal(out.key, KEY);
  assert.equal(out.metadata.source, "browser");
});

test("浏览器登录：state 不匹配时拒绝回调，取消后返回 failed", async () => {
  const methods = createMethods({ options: { lang: "zh" }, deps: { fetchImpl: async () => json({}) } });
  const method = methods[0];
  const controller = new AbortController();
  const authz = await method.authorize({}, { signal: controller.signal });
  const loginUrl = new URL(authz.url);
  const port = Number(loginUrl.searchParams.get("port"));

  const callback = await fetch(`http://127.0.0.1:${port}/auth-callback?code=x&state=wrong`);
  assert.equal(callback.status, 400);

  controller.abort();
  const out = await authz.callback();
  assert.equal(out.type, "failed");
});
