// 协议取证脚本：不经 magpie，直接验证网关/上游的契约。
//
//   node scripts/probe.mjs --mode gateway [--url http://127.0.0.1:10087] [--key …] [--admin …]
//   node scripts/probe.mjs --mode direct  [--key …] [--secret-dir …] [--base https://api.deepai.org]
//
// 输出每一步的“阶段 / 状态 / 原话 / 耗时”，全程脱敏（Key 只留前 6 后 4）。

import { findDesktopCredentials } from "../src/credentials.mjs";
import { exchangeCode, getDirectModels, getTheos, getUsageSummary, normalizeAllowance } from "../src/direct.mjs";
import { aggregatePool, getAccounts, getHealth, getModels, getOverview, postCheckin, singleAllowance } from "../src/gateway.mjs";
import { resolveMachineFingerprint } from "../src/machine.mjs";
import { formatNumber, parseResetTime, trimSlash } from "../src/util.mjs";

function parseArgs(argv) {
  const out = { mode: "gateway", checkin: false, chat: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--checkin") out.checkin = true;
    else if (arg === "--chat") out.chat = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function maskKey(key) {
  const v = String(key ?? "");
  if (!v) return "(none)";
  if (v.length <= 10) return `${v.slice(0, 1)}***`;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

function maskFp(fp) {
  return fp ? `${String(fp).slice(0, 8)}…` : "(empty)";
}

function step(name, detail) {
  console.log(`\n[${name}]`);
  for (const [k, v] of Object.entries(detail ?? {})) console.log(`  ${k}: ${v}`);
}

async function runDirect(args) {
  const origin = trimSlash(args.base || "https://api.deepai.org");
  let key = String(args.key ?? "").trim();
  let username = "";
  let source = "arg";

  if (!key) {
    const found = findDesktopCredentials({ explicit: String(args["secret-dir"] ?? "").trim() });
    if (!found.ok) {
      step("credentials", {
        ok: false,
        tried: found.tried?.join("\n    ") ?? "",
        reason: found.reason ?? "not found",
      });
      console.log("\n→ 先去 DeepAI Code 桌面端登录一次，或用 --key 传入 Key。");
      return 1;
    }
    key = found.cred.apiKey;
    username = found.cred.username;
    source = found.cred.path;
  }
  step("credentials", { source, key: maskKey(key), username: username || "(empty)" });

  const machineFp = resolveMachineFingerprint({ apiKey: key, machineMode: String(args.machine ?? "account") });
  step("machine", { fingerprint: maskFp(machineFp), mode: String(args.machine ?? "account") });

  let code = 0;
  await timed("models", async () => {
    const payload = await getDirectModels(origin, { machineFp });
    const models = payload?.models ?? [];
    step("models", { count: models.length, default: String(payload?.default ?? "(none)") });
  }).catch((err) => { code = 1; fail("models", err); });

  let allowance = null;
  await timed("theos", async () => {
    const payload = await getTheos(origin, { key, machineFp });
    allowance = normalizeAllowance(payload);
    step("theos", {
      enabled: allowance.enabled,
      balance: allowance.balance,
      granted: allowance.granted,
      refresh_at: allowance.rawRefreshAt || "(none)",
      parsed_reset: allowance.refreshAt ?? "(none)",
    });
  }).catch((err) => { code = 1; fail("theos", err); });

  await timed("usage_summary", async () => {
    const summary = await getUsageSummary(origin, { key, machineFp });
    step("usage_summary", {
      plan: summary?.plan ?? "(none)",
      is_pro: summary?.is_pro ?? "(none)",
      credits_remaining: summary?.credits_remaining ?? "(none)",
      period: summary?.period_description ?? "(none)",
      has_overages: summary?.has_overages ?? "(none)",
    });
  }).catch((err) => { code = 1; fail("usage_summary", err); });

  if (args.chat) {
    await timed("chat", async () => {
      const res = await fetch(`${origin}/deepai_code/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Api-Key": key,
          "X-DeepAI-Code-Theos": "2",
          "X-DeepAI-Code-Machine": machineFp,
        },
        body: JSON.stringify({
          model: String(args.model || "glm-5.3-flash"),
          messages: [{ role: "user", content: "reply with the single word OK" }],
          max_tokens: 8,
          stream: false,
        }),
        redirect: "error",
      });
      const text = await res.text();
      let content = "";
      try {
        content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
      } catch {
        content = text.slice(0, 200);
      }
      step("chat", { status: res.status, model: String(args.model || "glm-5.3-flash"), reply: JSON.stringify(content).slice(0, 120) });
      if (res.status !== 200) code = 1;
    }).catch((err) => { code = 1; fail("chat", err); });
  }

  return code;
}

async function runGateway(args) {
  const url = trimSlash(args.url || "http://127.0.0.1:10087");
  const key = String(args.key ?? "").trim();
  const admin = String(args.admin ?? "").trim();
  let code = 0;

  step("config", { url, key: maskKey(key), admin: admin ? "(set)" : "(empty)" });

  await timed("health", async () => {
    const health = await getHealth(url);
    step("health", {
      status: health?.status ?? "(none)",
      accounts: health?.accounts ?? "(none)",
      ready: health?.ready ?? "(none)",
      models: health?.models ?? "(none)",
      default_model: health?.default_model ?? "(none)",
      machine_ready: health?.machine_ready ?? "(none)",
    });
  }).catch((err) => { code = 1; fail("health", err); });

  await timed("models", async () => {
    const payload = await getModels(url, { key });
    const data = payload?.data ?? [];
    step("models", { count: data.length, first: data[0]?.id ?? "(none)" });
  }).catch((err) => { code = 1; fail("models", err); });

  await timed("theos", async () => {
    const payload = await fetch(`${url}/v1/deepai/theos`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      redirect: "error",
    }).then(async (res) => ({ status: res.status, body: await res.text() }));
    if (payload.status !== 200) throw new Error(`HTTP ${payload.status}: ${payload.body.slice(0, 200)}`);
    const allowance = singleAllowance(JSON.parse(payload.body));
    step("theos", {
      account: allowance.account || "(none)",
      username: allowance.username || "(none)",
      balance: allowance.balance || "(none)",
      granted: allowance.granted || "(none)",
      refresh_at: allowance.refreshAt ?? "(none)",
    });
  }).catch((err) => { code = 1; fail("theos", err); });

  if (admin) {
    await timed("overview", async () => {
      const overview = await getOverview(url, { admin });
      step("overview", {
        accounts: overview?.accounts ?? "(none)",
        ready: overview?.ready ?? "(none)",
        default_model: overview?.default_model ?? "(none)",
        upstream: overview?.upstream ?? "(none)",
      });
    }).catch((err) => { code = 1; fail("overview", err); });

    await timed("accounts", async () => {
      const items = await getAccounts(url, { admin });
      const pool = aggregatePool(items);
      step("pool", {
        total: pool.total,
        able: pool.enabled,
        with_quota: pool.withQuota,
        errors: pool.errored,
        sum_balance: formatNumber(pool.sumBalance),
        sum_granted: formatNumber(pool.sumGranted),
        earliest_reset: pool.earliestResetAt ?? "(none)",
      });
    }).catch((err) => { code = 1; fail("accounts", err); });

    if (args.checkin) {
      await timed("checkin", async () => {
        const payload = await postCheckin(url, { admin });
        const results = payload?.results ?? [];
        step("checkin", {
          ok: payload?.ok ?? "(none)",
          accounts: results.length,
          ok_count: results.filter((r) => r.ok).length,
          with_quota: results.filter((r) => Number(r?.theos?.balance ?? 0) > 0).length,
        });
      }).catch((err) => { code = 1; fail("checkin", err); });
    }
  } else {
    console.log("\n[admin] 未提供 --admin：跳过池级额度与签到（这是预期行为）。");
  }

  return code;
}

async function timed(name, fn) {
  const start = Date.now();
  try {
    const out = await fn();
    console.log(`  (${name} ${Date.now() - start}ms)`);
    return out;
  } catch (err) {
    throw err;
  }
}

function fail(name, err) {
  console.log(`  ✖ ${name}: HTTP ${err?.status ?? "-"} ${err?.message ?? err}`);
}

const args = parseArgs(process.argv.slice(2));
console.log("DeepAI Code probe — 全程脱敏，不写入任何文件");
const code = args.mode === "direct" ? await runDirect(args) : await runGateway(args);
process.exitCode = code; // 不立即 exit，避免 windows 上 undici 连接未收尾触发 libuv 断言
