// 额度与签到的输出构造。
//
// 两个约束来自 magpie 文档：
//   1) 厂商没给出用量就不要传 used，也不要用 0 表示“不知道”；
//   2) 有 amount + limit 时 magpie 自己算 used（limit - amount）。
// 所以：只有 granted > 0 才给 amount/limit，否则只给 display。

import { t } from "./i18n.mjs";
import { formatNumber, toNumber } from "./util.mjs";

/** 网关模式：池级额度窗口。 */
export function buildGatewayUsage({ pool, lang = "zh" }) {
  const total = toNumber(pool?.total, 0);
  const withQuota = toNumber(pool?.withQuota, 0);
  const balance = toNumber(pool?.sumBalance, 0);
  const granted = toNumber(pool?.sumGranted, 0);

  const usage = {
    plan: t(lang, "usagePoolPlan", { ready: toNumber(pool?.enabled, 0), total }),
    windows: [],
  };

  if (total === 0) {
    usage.error = t(lang, "usageNoAccount");
    return usage;
  }

  const window = {
    name: t(lang, "usagePoolName"),
    unit: "theos",
    aside: false,
    display: t(lang, "usagePoolDisplay", {
      withQuota,
      total,
      balance: formatNumber(balance),
      granted: formatNumber(granted),
    }),
  };
  if (granted > 0) {
    // magpie 的 amount 是“窗口内的已用量”，不是剩余量：已用 = 总额度 - 余额。
    window.amount = Math.max(0, granted - balance);
    window.limit = granted;
  }
  if (pool?.earliestResetAt) window.resetsAt = pool.earliestResetAt;

  usage.windows.push(window);
  if (toNumber(pool?.errored, 0) > 0) {
    usage.error = t(lang, "checkinPoolFailed", { n: toNumber(pool?.errored, 0) });
  }
  return usage;
}

/** 网关模式：没有管理密码时，用 /v1/deepai/theos 的单号视角兜底。 */
export function buildGatewaySingleUsage({ allowance, lang = "zh", note = "" }) {
  const usage = { plan: "", windows: [] };
  if (!allowance) {
    usage.error = t(lang, "usageNoAccount");
    return usage;
  }
  const balance = toNumber(allowance.balance, 0);
  const granted = toNumber(allowance.granted, 0);

  const window = {
    name: t(lang, "usageTodayName"),
    unit: "theos",
    aside: false,
    display: granted > 0
      ? t(lang, "usageLeftDisplay", { balance: formatNumber(balance), granted: formatNumber(granted) })
      : t(lang, "usagePending"),
  };
  if (granted > 0) {
    window.amount = Math.max(0, granted - balance);
    window.limit = granted;
  }
  if (allowance.refreshAt) window.resetsAt = allowance.refreshAt;
  if (note) window.display = `${window.display} · ${note}`;

  usage.windows.push(window);
  return usage;
}

/** 直连模式：/theos + /get_usage_summary。 */
export function buildDirectUsage({ allowance, summary, username = "", lang = "zh" }) {
  const usage = { windows: [] };
  const plan = String(summary?.plan ?? "").trim();
  if (plan) usage.plan = plan;
  if (username) usage.user = username;

  if (typeof summary?.credits_remaining === "number" && Number.isFinite(summary.credits_remaining)) {
    usage.balance = t(lang, "usageCredits", { n: formatNumber(summary.credits_remaining) });
  }
  if (summary?.has_overages) {
    usage.error = `overages: ${formatNumber(summary?.total_overage_cost ?? 0)}`;
  }

  if (!allowance) {
    usage.error = usage.error || t(lang, "usagePending");
    return usage;
  }

  const balance = toNumber(allowance.balance, 0);
  const granted = toNumber(allowance.granted, 0);
  const window = {
    name: t(lang, "usageTodayName"),
    unit: "theos",
    aside: false,
    display: granted > 0
      ? t(lang, "usageLeftDisplay", { balance: formatNumber(balance), granted: formatNumber(granted) })
      : t(lang, "usagePending"),
  };
  if (granted > 0) {
    window.amount = Math.max(0, granted - balance);
    window.limit = granted;
  }
  if (allowance.refreshAt) window.resetsAt = allowance.refreshAt;

  usage.windows.push(window);
  return usage;
}

/**
 * 直连模式签到判定。
 *
 * 上游没有独立签到端点：免费额度是“当天第一次带该指纹的认证请求”时发放。
 * 所以签到 = 调一次 /theos 触发并锁定当日额度，用 refresh_at 的变化判断是否“刚领到”。
 */
export function buildDirectCheckin({ allowance, prevRefreshAt = "", lang = "zh" }) {
  if (!allowance) return { outcome: "failed", message: t(lang, "checkinPending") };
  if (!allowance.enabled) return { outcome: "ineligible", message: t(lang, "checkinIneligible") };

  const granted = toNumber(allowance.granted, 0);
  const refresh = String(allowance.rawRefreshAt ?? "").trim();

  if (granted <= 0) return { outcome: "failed", message: t(lang, "checkinPending") };

  if (prevRefreshAt && refresh && prevRefreshAt === refresh) {
    return { outcome: "done", message: t(lang, "checkinAlready") };
  }
  return { outcome: "claimed", message: t(lang, "checkinGranted") };
}

/**
 * 网关模式签到结果汇总。
 * prevWithQuota 为上一次观察到的“有额度账号数”，用来判断本次是否真的新领到。
 */
export function buildGatewayCheckin({ results = [], prevWithQuota = null, lang = "zh" }) {
  const total = results.length;
  if (total === 0) return { outcome: "ineligible", message: t(lang, "usageNoAccount") };

  const okCount = results.filter((r) => r?.ok).length;
  const failed = total - okCount;
  if (okCount === 0) return { outcome: "failed", message: t(lang, "checkinPoolFailed", { n: failed }) };

  const withQuota = results.filter((r) => toNumber(r?.theos?.balance, 0) > 0).length;
  if (typeof prevWithQuota === "number" && withQuota > prevWithQuota) {
    return {
      outcome: "claimed",
      credit: withQuota - prevWithQuota,
      message: t(lang, "checkinPoolClaimed", { n: withQuota - prevWithQuota }),
    };
  }
  return { outcome: "done", message: t(lang, "checkinPoolDone", { n: okCount, withQuota }) };
}
