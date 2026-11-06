// 中英文案。默认中文，options.lang = "en" 切英文。
//
// 只放“用户能看到的字符串”：登录标签/提问、错误、额度窗口名。
// 上游/网关的原话永远原样透出，不进这里（那是厂商的话，翻译会丢信息）。

const MESSAGES = {
  zh: {
    providerName: "DeepAI Code",

    loginGateway: "本机网关 DeepAICode2API（高级）",
    loginDesktop: "读取本机 DeepAI Code 凭据",
    loginPaste: "粘贴 DeepAI API Key",
    loginBrowser: "浏览器登录 DeepAI（推荐）",

    promptGatewayUrl: "网关地址",
    promptGatewayKey: "网关 API Key（未签发密钥时填 loopback）",
    promptGatewayAdmin: "管理密码（可选，用于池级额度与签到）",
    promptSecretDir: "桌面端数据目录（留空自动探测）",
    promptDesktopKey: "输入 auto 读取本机凭据；或直接粘贴 Key",
    promptUsername: "账号名（可选，显示用）",
    promptApiKey: "DeepAI API Key",

    foundGateway: "已发现网关：{accounts} 个账号、{models} 个模型（{url}）",
    foundGatewayNoAccounts: "已发现网关，但号池还是空的：{url}",
    needGatewayKey: "该网关已签发密钥，请粘贴控制台里的 API Key",
    gatewayNoKeyIsFine: "网关未签发密钥，本机回环可直接使用",

    errGatewayDown: "网关未响应（{url}）。请先启动 DeepAICode2API，或在登录时改用“直连”。",
    errGatewayUnauthorized: "网关拒绝了请求：API Key 无效或已停用。",
    errGatewaySetupRequired: "网关还没签发任何密钥：请到控制台（{url}/）创建密钥后再登录。",
    errPoolEmpty: "号池暂无可调度账号。去控制台看看账号状态，或用 register.exe 补号。",
    errKeyMissing: "缺少 DeepAI API Key。",
    errNoCredentials: "没有找到桌面端凭据。已尝试：{tried}。请先在 DeepAI Code 桌面端登录一次。",
    errBadCredentials: "凭据文件解析失败：{path}（{reason}）",
    errSignInExpired: "登录已失效，请重新登录。",
    errLane: "上游不接受当前车道版本（426）。把选项 laneVersion 调成上游要求的值，或更新插件。",
    errTimeout: "操作超时，请重试。",
    errRedirect: "上游把请求重定向到了登录页（鉴权失败）。请重新登录。",

    usagePoolName: "号池额度",
    usagePoolPlan: "池 · {ready}/{total} 可用",
    usagePoolDisplay: "{withQuota}/{total} 个账号有额度 · 剩 {balance} / {granted} theos",
    usageTodayName: "今日 Theos",
    usagePending: "今日额度待发放",
    usageLeftDisplay: "剩 {balance} / {granted} theos",
    usageNoAdmin: "未配置管理密码，这里显示单个账号的额度",
    usageCredits: "{n} credits",
    usageNoAccount: "网关里还没有可用账号",

    checkinPoolDone: "已刷新 {n} 个账号额度，{withQuota} 个有余额",
    checkinPoolClaimed: "本次新拿到额度：{n} 个账号",
    checkinPoolFailed: "额度刷新失败：{n} 个账号",
    checkinGranted: "今日额度已领取",
    checkinAlready: "今天已经领过",
    checkinPending: "今日额度尚未发放",
    checkinIneligible: "该账号不参与每日额度",

    browserInstructions: "在浏览器里登录 DeepAI，完成后会自动跳回本机。若页面显示无法访问，把地址栏里的 code 复制进来即可。",
    browserDoneTitle: "登录完成",
    browserDoneBody: "可以回到 magpie 了。",
    browserFailedTitle: "登录失败",

    fallbackNote: "（模型目录拉取失败，显示内置快照）",
  },
  en: {
    providerName: "DeepAI Code",

    loginGateway: "Local DeepAICode2API gateway (advanced)",
    loginDesktop: "Read DeepAI Code desktop credentials",
    loginPaste: "Paste DeepAI API key",
    loginBrowser: "Sign in with DeepAI (recommended)",

    promptGatewayUrl: "Gateway URL",
    promptGatewayKey: "Gateway API key (type loopback when no key is issued)",
    promptGatewayAdmin: "Admin password (optional; pool quota & check-in)",
    promptSecretDir: "Desktop data dir (empty = auto-detect)",
    promptDesktopKey: "Type auto to read the desktop credentials, or paste a key",
    promptUsername: "Account name (optional, for display)",
    promptApiKey: "DeepAI API key",

    foundGateway: "Gateway found: {accounts} accounts, {models} models ({url})",
    foundGatewayNoAccounts: "Gateway found, but its account pool is empty ({url})",
    needGatewayKey: "This gateway has issued keys. Paste one from its console.",
    gatewayNoKeyIsFine: "No key issued yet — loopback access is open.",

    errGatewayDown: "Gateway is not responding ({url}). Start DeepAICode2API, or sign in with “direct” instead.",
    errGatewayUnauthorized: "The gateway rejected the request: API key invalid or disabled.",
    errGatewaySetupRequired: "The gateway has no API key yet. Create one at {url}/ and sign in again.",
    errPoolEmpty: "No account available in the pool. Check the console, or add accounts with register.exe.",
    errKeyMissing: "DeepAI API key is missing.",
    errNoCredentials: "Desktop credentials not found. Tried: {tried}. Sign in to the DeepAI Code desktop app first.",
    errBadCredentials: "Cannot parse credentials: {path} ({reason})",
    errSignInExpired: "Sign-in expired. Please sign in again.",
    errLane: "Upstream rejected the lane version (426). Set the laneVersion option to the expected value.",
    errTimeout: "Timed out. Please retry.",
    errRedirect: "Upstream redirected to the sign-in page (auth failed). Please sign in again.",

    usagePoolName: "Pool quota",
    usagePoolPlan: "Pool · {ready}/{total} ready",
    usagePoolDisplay: "{withQuota}/{total} accounts have quota · {balance} / {granted} left",
    usageTodayName: "Today's theos",
    usagePending: "Today's grant not issued yet",
    usageLeftDisplay: "{balance} / {granted} theos left",
    usageNoAdmin: "No admin password: showing a single account's quota",
    usageCredits: "{n} credits",
    usageNoAccount: "No usable account in the gateway yet",

    checkinPoolDone: "Refreshed {n} accounts, {withQuota} have quota",
    checkinPoolClaimed: "Newly granted: {n} accounts",
    checkinPoolFailed: "Quota refresh failed for {n} accounts",
    checkinGranted: "Today's quota claimed",
    checkinAlready: "Already claimed today",
    checkinPending: "Today's grant is not issued yet",
    checkinIneligible: "This account has no daily grant",

    browserInstructions: "Sign in to DeepAI in the browser; you'll be sent back to this machine automatically. If the page can't open, paste the code param from the address bar.",
    browserDoneTitle: "Signed in",
    browserDoneBody: "You can go back to magpie now.",
    browserFailedTitle: "Sign-in failed",

    fallbackNote: "(model catalog fetch failed; showing built-in snapshot)",
  },
};

export function resolveLang(options = {}) {
  const lang = String(options.lang ?? "zh").toLowerCase();
  return lang.startsWith("en") ? "en" : "zh";
}

export function t(lang, key, vars = {}) {
  const dict = MESSAGES[lang] ?? MESSAGES.zh;
  const raw = dict[key] ?? MESSAGES.zh[key] ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
}

export const MESSAGES_ALL = MESSAGES;
