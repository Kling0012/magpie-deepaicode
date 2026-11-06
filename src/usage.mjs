// 额度与签到的输出构造。
//
// 两个约束来自 magpie 文档：
//   1) 厂商没给出用量就不要传 used，也不要用 0 表示“不知道”；
//   2) 有 amount + limit 时 magpie 自己算 used（limit - amount）。
// 所以：只有 granted > 0 才给 amount/limit，否则只给 display。

import { t } from "./i18n.mjs";
import { formatNumber, toNumber } from "./util.mjs";

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
    // magpie 的 amount 是“窗口内的已用量”，不是剩余量：已用 = 总额度 - 余额。
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
