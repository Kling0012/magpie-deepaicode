# Changelog

## 未发布 — 2026-11-07（上游客户端过滤适配）

- **根因修复：显式 `User-Agent`**。上游 2026-11-07 上线 UA 侧客户端过滤：Node 宿主
  undici fetch 默认发 `user-agent: node`，`/chat/completions` 直接
  `400 "This request is not one DeepAI Code sends."`（Node 20 与 Node 24 宿主均命中；
  Bun 宿主自带 UA、curl、Electron net 栈不受影响）。插件现在在所有直连请求上
  显式发送 `magpie-deepaicode/<version>`。
- `DEFAULT_LANE_VERSION` 改为 `"4"`（与桌面端 `server.asar` 的 `DEEPAI_LANE_HEADERS`
  对齐）。注：早前 "`2` 全线 426" 的观察是在 `user-agent: node` 污染下测得；
  设 UA 后 lane 2/4 在 chat 上均 200，车道值仍以桌面端为准。
- 桌面端对齐头：`X-DeepAI-Code-Instance`（每进程随机 32 hex）与 `/theos` 的
  `X-DeepAI-Code-Beacon`（`v=版本;up=运行秒;pi;focus`）。实测非必需，带上无害。
- PROTOCOL.md §1.2/§1.3 记录完整因果链与两条新错误语义；测试 54 → 55。
- `laneVersion` 默认改为 `"auto"`：降序探测 `/models`（免鉴权、无签到副作用、对
  车道值做白名单校验）取最大受理值，进程内缓存一次——上游再升车道时插件自动
  跟进，无需改选项。显式值（如 `"4"`）仍然生效且不探测。
  E2E（2026-11-07）：auto 解析出 `4`，chat 200 "ok"。
- 端到端验证（2026-11-07 本机）：models 200（18 个，免费 9）；loader chat 200
  SSE 流式 `[DONE]`；`/theos` 200（granted=50）。

## 0.2.0 — 2026-11-07

按 magpie 社区收录要求（PR #805 审查意见）做出的重要变更：

- **移除"每账号派生指纹"**（`machineMode: "account"`，`uuidv5(sha256(key))`）。
  插件现在只发送**真实设备指纹**（SMBIOS UUID / `MachineGuid` / IOPlatformUUID /
  `/etc/machine-id`），哈希方式与桌面端一致。同一设备上的多个账号共享该设备的一次
  每日免费额度——这是 DeepAI 的设备配额设计，插件不做绕过。
- **移除本机网关（DeepAICode2API）模式**：登录项与 `showGatewayLogin` / `gatewayUrl` /
  `gatewayKey` / `gatewayAdmin` 选项、池级额度（`/admin/api/accounts` 聚合）与池签到
  （`/admin/api/checkin`）全部删除；`src/gateway.mjs`、`scripts/mock-gateway.mjs` 移除。
  插件只保留直连上游一种模式。自己账号的三路登录（浏览器 / 桌面端凭据 / API Key）不变。
- **修复 debug 日志泄密**：`debug: true` 时登录过程只记录"哪些字段有值"（字段名），
  绝不打印 Key / 管理密码等内容；新增回归测试。
- 登录不再在 metadata 里保存 `machineMode` / `machineId`。
- 403（`/theos` 验活）文案改为"登录已失效"（原误用"缺少 Key"）。
- 文档同步：README（中/英）、PROTOCOL.md 移除网关章节；测试 75 → 54（网关用例移除）。

升级提示：0.1.x 的网关账号需要在 magpie 里重新以三路方式之一登录；已登录的直连账号
不受影响（额度键从"派生指纹"变为"真实设备指纹"，单账号用户的每日额度行为不变）。

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
