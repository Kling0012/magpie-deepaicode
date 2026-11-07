import test from "node:test";
import assert from "node:assert/strict";

import {
  directBase,
  directHeaders,
  exchangeCode,
  getDirectModels,
  getTheos,
  normalizeAllowance,
  resolveLaneVersion,
  resetAutoLaneCache,
} from "../src/direct.mjs";
import { buildDirectCheckin, buildDirectUsage } from "../src/usage.mjs";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("directBase / directHeaders：Api-Key 而不是 Authorization", () => {
  assert.equal(directBase("https://api.deepai.org/"), "https://api.deepai.org/deepai_code");
  const headers = directHeaders({ key: "k", machineFp: "fp", laneVersion: "4" });
  assert.equal(headers["Api-Key"], "k");
  assert.equal(headers["X-DeepAI-Code-Theos"], "4");
  assert.match(headers["X-DeepAI-Code-Instance"], /^[0-9a-f]{32}$/);
  assert.equal(headers["X-DeepAI-Code-Machine"], "fp");
  assert.equal(headers.Authorization, undefined);
  assert.match(headers["User-Agent"], /^magpie-deepaicode\//, "必须显式 UA：undici 默认 user-agent: node 会被上游 400");
});

test("directHeaders：实例 id 每进程稳定", () => {
  const a = directHeaders({});
  const b = directHeaders({});
  assert.equal(a["X-DeepAI-Code-Instance"], b["X-DeepAI-Code-Instance"]);
});

test("getDirectModels：免鉴权，只带车道与机器指纹", async () => {
  let captured = null;
  await getDirectModels("https://api.deepai.org", {
    machineFp: "fp",
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers };
      return jsonResponse({ models: [] });
    },
  });
  assert.equal(captured.url, "https://api.deepai.org/deepai_code/models");
  assert.equal(captured.headers["Api-Key"], undefined);
  assert.equal(captured.headers["X-DeepAI-Code-Machine"], "fp");
});

test("getTheos：URL 与头正确", async () => {
  let captured = null;
  await getTheos("https://api.deepai.org", {
    key: "k",
    machineFp: "fp",
    fetchImpl: async (url, init) => {
      captured = { url, headers: init.headers };
      return jsonResponse({ enabled: true, balance: "200.00000", granted: "200.00000" });
    },
  });
  assert.equal(captured.url, "https://api.deepai.org/deepai_code/theos");
  assert.equal(captured.headers["Api-Key"], "k");
  assert.match(captured.headers["X-DeepAI-Code-Beacon"], /^v=[^;]+;up=\d+;pi=[01];focus=[01]$/);
});

test("normalizeAllowance：字符串数值与 refresh_at 归一化", () => {
  const a = normalizeAllowance({ enabled: true, balance: "200.00000", granted: "200.00000", refresh_at: "2026-11-07T04:03:03Z" });
  assert.equal(a.balance, "200.00000");
  assert.equal(a.granted, "200.00000");
  assert.equal(a.refreshAt, "2026-11-07T04:03:03.000Z");
  assert.equal(a.rawRefreshAt, "2026-11-07T04:03:03Z");

  const b = normalizeAllowance({ enabled: false, balance: "0", granted: "0", refresh_at: 1794000000 });
  assert.equal(b.refreshAt, new Date(1794000000 * 1000).toISOString());
  assert.equal(b.enabled, false);
});

test("buildDirectUsage：正常额度 / 未发放", () => {
  const usage = buildDirectUsage({
    allowance: normalizeAllowance({ enabled: true, balance: "200.00000", granted: "200.00000", refresh_at: "2026-11-07T04:03:03Z" }),
    summary: { plan: "Free", credits_remaining: 12.4 },
    username: "ada",
  });
  assert.equal(usage.plan, "Free");
  assert.equal(usage.user, "ada");
  // amount 是“已用量”（granted - balance），不是剩余：200/200 即已用 0
  assert.equal(usage.windows[0].amount, 0);
  assert.equal(usage.windows[0].limit, 200);
  assert.ok(usage.balance.includes("12.4"));

  const pending = buildDirectUsage({
    allowance: normalizeAllowance({ enabled: true, balance: "0.00000", granted: "0.00000" }),
    summary: null,
  });
  assert.equal(pending.windows[0].amount, undefined);
  assert.equal(pending.windows[0].limit, undefined);

  // 额度用完：已用 = 总额度
  const spent = buildDirectUsage({
    allowance: normalizeAllowance({ enabled: true, balance: "0.00000", granted: "200.00000" }),
    summary: null,
  });
  assert.equal(spent.windows[0].amount, 200);
  assert.equal(spent.windows[0].limit, 200);
});

test("buildDirectCheckin：四分支", () => {
  const base = { enabled: true, balance: "200", granted: "200", rawRefreshAt: "2026-11-07T04:03:03Z" };
  assert.equal(buildDirectCheckin({ allowance: base, prevRefreshAt: "" }).outcome, "claimed");
  assert.equal(buildDirectCheckin({ allowance: base, prevRefreshAt: "2026-11-07T04:03:03Z" }).outcome, "done");
  assert.equal(
    buildDirectCheckin({ allowance: base, prevRefreshAt: "2026-11-06T04:03:03Z" }).outcome,
    "claimed",
  );
  assert.equal(
    buildDirectCheckin({ allowance: { ...base, granted: "0" } }).outcome,
    "failed",
  );
  assert.equal(
    buildDirectCheckin({ allowance: { ...base, enabled: false } }).outcome,
    "ineligible",
  );
  assert.equal(buildDirectCheckin({ allowance: null }).outcome, "failed");
});

test("exchangeCode：成功与坏响应", async () => {
  let captured = null;
  const cred = await exchangeCode("https://api.deepai.org", "abc", {
    fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return jsonResponse({ api_key: "fake-deepai-key-0001", username: "ada", is_pro: false });
    },
  });
  assert.equal(captured.url, "https://api.deepai.org/deepai_code/desktop_auth/exchange/");
  assert.deepEqual(captured.body, { code: "abc" });
  assert.equal(cred.username, "ada");

  await assert.rejects(
    exchangeCode("https://api.deepai.org", "abc", { fetchImpl: async () => jsonResponse({}) }),
    /invalid-exchange-response/,
  );
  await assert.rejects(exchangeCode("https://api.deepai.org", "  ", { fetchImpl: async () => jsonResponse({}) }), /empty-code/);
});

test("resolveLaneVersion：显式值原样返回，auto 降序探测取最大受理值", async () => {
  resetAutoLaneCache();
  // 显式值不探测
  assert.equal(await resolveLaneVersion("https://api.deepai.org", { laneVersion: "3", fetchImpl: async () => { throw new Error("不应发请求"); } }), "3");

  // auto：>4 一律 426，<=4 返回 200 → 应选中 "4"（最大受理值）
  const seen = [];
  const lane = await resolveLaneVersion("https://api.deepai.org", {
    laneVersion: "auto",
    fetchImpl: async (url, init) => {
      const v = init.headers["X-DeepAI-Code-Theos"];
      seen.push(v);
      return Number(v) > 4
        ? jsonResponse({ error: { message: "unsupported" } }, 426)
        : jsonResponse({ models: [] });
    },
  });
  assert.equal(lane, "4");
  assert.deepEqual(seen, ["12", "11", "10", "9", "8", "7", "6", "5", "4"]);
});

test("resolveLaneVersion：全部 426 退回默认值；非 426 错误原样抛出", async () => {
  resetAutoLaneCache();
  assert.equal(
    await resolveLaneVersion("https://api.deepai.org", {
      laneVersion: "auto",
      fetchImpl: async () => jsonResponse({ error: { message: "unsupported" } }, 426),
    }),
    "4",
  );
  await assert.rejects(
    resolveLaneVersion("https://api.deepai.org", {
      laneVersion: "auto",
      fetchImpl: async () => jsonResponse({ error: { message: "boom" } }, 500),
    }),
    /HTTP 500/,
  );
});
