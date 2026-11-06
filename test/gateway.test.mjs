import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePool,
  getAccounts,
  getModels,
  getTheos,
  postCheckin,
  singleAllowance,
} from "../src/gateway.mjs";
import { HttpError } from "../src/http.mjs";
import { buildGatewayCheckin, buildGatewaySingleUsage, buildGatewayUsage } from "../src/usage.mjs";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("aggregatePool：字符串数值、有额度账号数、最早刷新时间", () => {
  const pool = aggregatePool([
    { enabled: true, theos: { balance: "200.00000", granted: "200.00000", refresh_at: "2026-11-07T04:03:03Z" } },
    { enabled: true, theos: { balance: "0", granted: "200.00000", refresh_at: "2026-11-08T04:03:03Z" } },
    { enabled: false, status: "error", last_err: "boom", theos: { balance: "0", granted: "0" } },
    { enabled: true },
  ]);
  assert.equal(pool.total, 4);
  assert.equal(pool.enabled, 3);
  assert.equal(pool.withQuota, 1);
  assert.equal(pool.errored, 1); // 只有 status=error/last_err 的那个
  assert.equal(pool.sumBalance, 200);
  assert.equal(pool.sumGranted, 400);
  assert.equal(pool.earliestResetAt, "2026-11-07T04:03:03.000Z");
});

test("aggregatePool：空池", () => {
  const pool = aggregatePool([]);
  assert.deepEqual(pool, {
    total: 0,
    enabled: 0,
    withQuota: 0,
    errored: 0,
    sumBalance: 0,
    sumGranted: 0,
    earliestResetAt: undefined,
  });
});

test("getModels：带 Bearer；无 key 时不带", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return jsonResponse({ object: "list", data: [] });
  };
  await getModels("http://127.0.0.1:10087/", { key: "sk-1", fetchImpl });
  assert.equal(seen[0].url, "http://127.0.0.1:10087/v1/models");
  assert.equal(seen[0].headers.Authorization, "Bearer sk-1");

  await getModels("http://127.0.0.1:10087", { key: "", fetchImpl });
  assert.equal(seen[1].headers.Authorization, undefined);
});

test("getAccounts：按 total 翻页", async () => {
  const pages = [
    { items: [{ id: "a" }, { id: "b" }], total: 3, offset: 0, limit: 2 },
    { items: [{ id: "c" }], total: 3, offset: 2, limit: 2 },
  ];
  let call = 0;
  const items = await getAccounts("http://gw", {
    admin: "pw",
    limit: 2,
    fetchImpl: async (url) => {
      assert.match(url, /offset=\d+&limit=2/);
      return jsonResponse(pages[call++]);
    },
  });
  assert.deepEqual(items.map((i) => i.id), ["a", "b", "c"]);
  assert.equal(call, 2);
});

test("getAccounts：管理密码走 X-Admin-Password", async () => {
  let headers = null;
  await getAccounts("http://gw", {
    admin: "pw",
    fetchImpl: async (_url, init) => {
      headers = init.headers;
      return jsonResponse({ items: [], total: 0 });
    },
  });
  assert.equal(headers["X-Admin-Password"], "pw");
});

test("postCheckin：POST 空对象或指定 id", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    return jsonResponse({ ok: true, results: [] });
  };
  await postCheckin("http://gw", { admin: "pw", fetchImpl });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "http://gw/admin/api/checkin");
  assert.equal(calls[0].body, "{}");

  await postCheckin("http://gw", { admin: "pw", id: "abc", fetchImpl });
  assert.deepEqual(JSON.parse(calls[1].body), { id: "abc" });
});

test("getTheos：解码 {account,username,theos}", async () => {
  const payload = await getTheos("http://gw", {
    key: "sk",
    fetchImpl: async () => jsonResponse({ account: "a1", username: "ada", theos: { enabled: true, balance: "200.00000" } }),
  });
  const allowance = singleAllowance(payload);
  assert.equal(allowance.account, "a1");
  assert.equal(allowance.balance, "200.00000");
});

test("HttpError：解析网关错误体的 message/code", async () => {
  try {
    await getModels("http://gw", {
      key: "bad",
      fetchImpl: async () => jsonResponse({ error: { message: "API 密钥无效或已停用", type: "invalid_request_error", code: 401 } }, 401),
    });
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 401);
    assert.match(err.message, /API 密钥无效/);
    assert.equal(err.upstream.code, "401");
  }
});

test("buildGatewayUsage：池级窗口（用 amount/limit，不用 used）", () => {
  const usage = buildGatewayUsage({
    pool: { total: 4, enabled: 3, withQuota: 1, errored: 0, sumBalance: 200, sumGranted: 400, earliestResetAt: "2026-11-07T04:03:03.000Z" },
    lang: "zh",
  });
  assert.equal(usage.plan, "池 · 3/4 可用");
  assert.equal(usage.windows.length, 1);
  assert.equal(usage.windows[0].amount, 200);
  assert.equal(usage.windows[0].limit, 400);
  assert.equal(usage.windows[0].unit, "theos");
  assert.equal(usage.windows[0].aside, false);
  assert.ok(usage.windows[0].display.includes("1/4"));
  assert.equal(usage.windows[0].resetsAt, "2026-11-07T04:03:03.000Z");
});

test("buildGatewayUsage：总额度为 0 时只给 display", () => {
  const usage = buildGatewayUsage({
    pool: { total: 2, enabled: 2, withQuota: 0, errored: 0, sumBalance: 0, sumGranted: 0 },
  });
  assert.equal(usage.windows[0].amount, undefined);
  assert.equal(usage.windows[0].limit, undefined);
  assert.ok(usage.windows[0].display.length > 0);
});

test("buildGatewayUsage：空池给 error", () => {
  const usage = buildGatewayUsage({ pool: aggregatePool([]) });
  assert.deepEqual(usage.windows, []);
  assert.ok(usage.error);
});

test("buildGatewaySingleUsage：无管理密码的降级视角", () => {
  const usage = buildGatewaySingleUsage({
    allowance: { balance: "200.00000", granted: "200.00000", refreshAt: "2026-11-07T04:03:03.000Z" },
    note: "未配置管理密码",
  });
  assert.equal(usage.windows[0].amount, 0, "200/200 应为已用 0");
  assert.equal(usage.windows[0].limit, 200);
  assert.ok(usage.windows[0].display.includes("未配置管理密码"));
});

test("buildGatewayCheckin：全失败 / 新领到 / 已领过", () => {
  assert.equal(buildGatewayCheckin({ results: [] }).outcome, "ineligible");
  assert.equal(buildGatewayCheckin({ results: [{ ok: false }, { ok: false }] }).outcome, "failed");
  assert.equal(buildGatewayCheckin({ results: [{ ok: true, theos: { balance: "0" } }], prevWithQuota: 1 }).outcome, "done");

  const claimed = buildGatewayCheckin({
    results: [{ ok: true, theos: { balance: "200" } }, { ok: true, theos: { balance: "0" } }],
    prevWithQuota: 0,
  });
  assert.equal(claimed.outcome, "claimed");
  assert.equal(claimed.credit, 1);
});
