# Changelog

## 0.1.1 — 2026-11-06

- 登录方式重排：**浏览器登录（推荐）→ 读取本机凭据 → 粘贴 API Key**。
- "本机 DeepAICode2API"登录方式**默认隐藏**，用 `showGatewayLogin: true` 打开（排在最后）。
- 默认模式改为 `direct`；`config` 钩子声明的供应商 `api` 随之指向直连基地址。
- 新增 `icon.svg`（供仓库 / 社区 registry 引用）；npm 包版本升到 0.1.1。

## 0.1.0 — 2026-11-06

首个版本，双模式供应商插件。

- 供应商 `deepaicode`，模型写作 `deepaicode/<model>`；目录动态拉取，2026-11-06 快照兜底（14 个模型）。
- **gateway 模式（默认）**：本机 DeepAICode2API；`/health` 免鉴权发现；可选网关 Key 与管理密码；池级额度聚合；`/admin/api/checkin` 签到。
- **direct 模式**：`api.deepai.org`；四种登录中的三种（桌面端凭据 / 粘贴 Key / 浏览器 + localhost 回调）；每账号独立机器指纹（`uuidv5(sha256(key))`，可切 `device`）。
- 错误语义：`409 session_busy` → 429（`Retry-After` 夹 30s）；`403 email_unverified` → `X-Magpie-Sign-In: expired`；`426` 不标记账号；`302` 不跟随 → 401；网关池空 503 → 429。
- 模型映射：`theosPerRequest == "0"` → `free: true`；premier → `rate`；`gpt-6-astra` 带模型级 `provider.npm` 覆盖（Responses）。
- 会话粘性：`chat.headers` 注入 `X-Session-Affinity`。
- 工具：`scripts/probe.mjs`（脱敏取证）、`scripts/mock-gateway.mjs`（离线网关）、69 个单测。

首版曾列为待验证的项（除最后两项外均已完成，见下）：

- 有可用 DeepAI 账号时的 chat/streaming、工具调用、图片输入；
- `reasoning` 字段是否需要补写 `reasoning_content`；
- magpie 对"模型级 npm 覆盖"的支持（`gpt-6-astra`）；
- 浏览器登录 `desktop_auth` 的 `state`/`port` 校验细节。

### 真机回归结果（2026-11-06 晚，已在 0.1.0 上补测）

真实账号（桌面端已登录）+ 本地编译的参考网关，逐项结果：

| 项目 | 结果 |
|---|---|
| 网关模式登录 / 目录 / 额度 / 签到 | ✅ 14 模型；池 1/1；`剩 200 / 200 theos`；checkin `done` |
| 直连模式登录（读桌面端凭据） | ✅ 账号名已脱敏；`剩 200 / 200 theos` |
| chat（网关 / 直连） | ✅ 21,037 ms（冷启动）/ 686 ms |
| 流式 | ✅ SSE 4 chunk + `[DONE]` |
| 工具调用 | ✅ `finish_reason: tool_calls`，参数正确 |
| 图片输入 | ✅ 200，模型正确描述颜色 |
| 模型级 npm 覆盖 | ✅ `gpt-6-astra` → `@ai-sdk/openai`，Responses 通道走通（mock） |
| 管理接口无密码 + 回环 | ✅ 可读；插件已改为"先试再降级" |
| 上游思维链字段 | ✅ 实测为 `reasoning`（无 `reasoning_content`）；magpie 侧是否展示待观察 |

仍未验证：magpie 是否把 `reasoning` 渲染给 Agent；浏览器登录的真实回调细节。
