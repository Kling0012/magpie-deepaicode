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
  assert.equal(t("zh", "usageLeftDisplay", { balance: "200", granted: "200" }), "剩 200 / 200 theos");
  assert.equal(t("en", "usageCredits", { n: 42 }), "42 credits");
  assert.equal(t("en", "missing-key"), "missing-key");
});
