// 钩子级联调：对着一台正在运行的网关（真网关或 mock）跑 models / usage / checkin / loader。
//
//   node scripts/smoke.mjs --url http://127.0.0.1:10099 [--key …] [--admin …]
//
// 与 magpie 无关：这里直接调用插件返回的钩子，验证"账号 → 钩子 → 网关"这条链路。

import { DeepAICodePlugin, resolveOptions } from "../index.mjs";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}

const url = arg("url", "http://127.0.0.1:10099");
const key = arg("key", "loopback");
const admin = arg("admin", "");

const options = resolveOptions({}, { debug: false });
const auth = {
  type: "api",
  key,
  accountId: `gw:${url.replace(/^https?:\/\//, "")}:smoke`,
  metadata: { mode: "gateway", url, admin, keyless: key === "loopback" },
};

const hooks = await DeepAICodePlugin({}, options);
const getAuth = async () => auth;

console.log("[models]");
const models = await hooks.provider.models({ models: {} }, { auth });
const ids = Object.keys(models);
console.log(`  count: ${ids.length}`);
console.log(`  first: ${ids.slice(0, 4).join(", ")}`);
console.log(`  free flags: ${ids.filter((id) => models[id].free).length}`);

console.log("[usage]");
const usage = await hooks.auth.usage(getAuth);
console.log(`  ${JSON.stringify(usage)}`);

console.log("[checkin]");
const checkin = await hooks.auth.checkin(getAuth);
console.log(`  ${JSON.stringify(checkin)}`);

console.log("[loader]");
const loader = await hooks.auth.loader(getAuth);
console.log(`  baseURL: ${loader.baseURL}`);
console.log(`  apiKey: ${loader.apiKey ? "(set)" : "(none)"}`);
const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: ids[0], messages: [{ role: "user", content: "ping" }], stream: true, max_tokens: 8 }),
});
console.log(`  chat status: ${res.status} ${res.headers.get("content-type") ?? ""}`);
if (res.ok && res.body) {
  const reader = res.body.getReader();
  let chunks = 0;
  let done = false;
  while (!done) {
    const out = await reader.read();
    if (out.done) break;
    chunks += 1;
    if (new TextDecoder().decode(out.value).includes("[DONE]")) done = true;
  }
  console.log(`  stream chunks: ${chunks}${done ? " (saw [DONE])" : ""}`);
}
