import test from "node:test";
import assert from "node:assert/strict";

import { MESSAGES_ALL, resolveLang, t } from "../src/i18n.mjs";

test("中英文案键一致", () => {
  const zh = Object.keys(MESSAGES_ALL.zh).sort();
  const en = Object.keys(MESSAGES_ALL.en).sort();
  assert.deepEqual(en, zh);
});

test("resolveLang：默认中文，en 开头切英文", () => {
  assert.equal(resolveLang({}), "zh");
  assert.equal(resolveLang({ lang: "en-US" }), "en");
  assert.equal(resolveLang({ lang: "fr" }), "zh");
});

test("t：变量替换与缺键回退", () => {
  assert.equal(t("zh", "errGatewayDown", { url: "http://gw" }), "网关未响应（http://gw）。请先启动 DeepAICode2API，或在登录时改用“直连”。");
  assert.equal(t("en", "usagePoolPlan", { ready: 3, total: 4 }), "Pool · 3/4 ready");
  assert.equal(t("en", "missing-key"), "missing-key");
});
