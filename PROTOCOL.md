# 协议事实基线（PROTOCOL.md）

本文件记录插件实现所依赖的**上游与网关契约**，以及每条结论的证据等级。
它替代"每次改动都去翻反编译源码"：实现有疑问时先看这里。

- 快照日期：**2026-11-06**（模型目录同日期）
- 参考实现：[DeepAICode2API](https://github.com/2951461586/DeepAICode2API)（MIT）——上游协议的逆向结论来自它的 `internal/deepai/*`、`internal/server/*`、`docs/recon.md`
- 插件规范：[magpie 插件开发指南](https://usemagpie.ai/docs/zh/plugins)

证据等级：

| 标记 | 含义 |
|---|---|
| **实测** | 本机/本仓库真实发过请求并观察到的结果 |
| **源码级** | 与参考实现源码一致（行为可由其单测/README 佐证） |
| **推断** | 尚未验证，实现里已留降级路径 |

---

## 1. 上游（直连模式，`api.deepai.org`）

### 1.1 端点

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/deepai_code/chat/completions` | 推理（OpenAI chat 兼容，支持 tools / 图片） | `Api-Key` |
| POST | `/deepai_code/responses` | 推理（仅 `api=openai-responses` 的模型，如 `gpt-6-astra`） | `Api-Key` |
| GET | `/deepai_code/models` | 模型目录 | **免鉴权** |
| GET | `/deepai_code/theos` | 免费额度 / 余额 | `Api-Key` |
| GET | `/get_usage_summary` | 订阅与用量摘要（根路径） | `Api-Key` |
| GET | `/deepai_code/desktop_auth/?state=…&port=…` | 浏览器登录起点 | 无 |
| POST | `/deepai_code/desktop_auth/exchange/` | `{code}` → `{api_key, username, is_pro}` | 无 |

基础地址 `https://api.deepai.org`（插件选项 `baseOrigin` 可覆盖）。

### 1.2 请求头

| 头 | 值 | 作用 |
|---|---|---|
| `Api-Key` | 账号 Key（UUID 形态 `8-4-4-4-12`） | **鉴权走这个头，不是 `Authorization`** |
| `X-DeepAI-Code-Theos` | `2` | 计费车道版本；不对会 `426` |
| `X-DeepAI-Code-Machine` | `sha256(小写原始 UUID)` 十六进制 | 每日免费额度的分配键 |
| `X-Session-Affinity` | 任意会话 id | 会话粘性（body 的 `prompt_cache_key` 同效） |

### 1.3 错误语义

| 状态 | body | 含义 | 插件处理 |
|---|---|---|---|
| `409` | `{"error":{"code":"session_busy"}}` + `Retry-After` | 容量拒绝 | **转 429**（`Retry-After` 夹到 30s），交给 magpie 换号 |
| `401` | — | 鉴权失败 | 原样 401（magpie 标记账号） |
| `403` + `email_unverified` | — | 邮箱未验证 | 原样 403 + `X-Magpie-Sign-In: expired` |
| `426` + `lane_version_unsupported` | — | 车道/指纹问题 | 原样 426，不标记账号 |
| `400/404/422` | — | 请求本身的问题 | 原样透出 |
| `302` | 登录页 | 无效 Key | **不跟随**（`redirect: "error"`）→ 转 401 |
| `5xx` / 网络错误 | — | 抖动 | 原样 / 抛错，交给 magpie |

`Retry-After` 解析：秒数，>30 夹到 30（与参考实现一致）。

### 1.4 桌面端凭据

```
base    : T3CODE_HOME → DEEPAI_CODE_HOME → ~/.deepai-code
secrets : <base>/userdata/secrets → <base>/secrets → <base>/dev/secrets
文件名  : deepai-account.bin（首选）→ deepai-account-user-managed.bin
内容    : {"apiKey":"…","username":"…","isPro":false}   // 明文 JSON
```

显式路径（目录 / stateDir / secrets 目录 / 文件本身）优先于自动探测。

### 1.5 额度

| 项 | 事实 | 等级 |
|---|---|---|
| 分配键 | `(X-DeepAI-Code-Machine, 账号)`，每天一次；共用指纹时只有第一个账号能领 | 源码级（参考实现 §6.9–6.13：补齐独立指纹后 121 号全 `balance=200`） |
| `/theos` 字段 | `{enabled, balance, granted, refresh_at, lane_version}`；`balance`/`granted` 是**字符串**，5 位小数 | 源码级 |
| 刷新时间 | `refresh_at` 为 ISO（例如次日 UTC 04:03） | 源码级 |
| 新账号首次 | 常见 `granted=0`，几分钟后才 200 | 源码级（参考实现因此做 3/6/12 分钟延迟复探） |
| 单请求成本 | 约 `1.8e-6`，小额调用看不出余额下降 | 源码级（README §6.10 注） |

### 1.6 模型目录快照（2026-11-06 实测）

`GET /deepai_code/models` **免鉴权**，实测 HTTP 200，14 个模型，默认 `glm-5.3-flash`。
字段：`{id, name, reasoning, input[], contextWindow, maxTokens, premier, theosPerRequest, api?}`。

| id | 名称 | API | 免费 | 上下文 | 输入 | Theos/请求 |
|---|---|---|---|---|---|---|
| `glm-5.3-flash` | GLM 5.3 Flash | chat | ✅ | 1,048,576 | text,image | 0 |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | chat | ✅ | 1,048,576 | text,image | 0 |
| `mimo-2.6-flash` | MiMo 2.6 Flash | chat | ✅ | 1,048,576 | text,image | 0 |
| `solar-mini-4` | Solar Mini 4 | chat | ✅ | 524,288 | text | 0 |
| `gpt-6-luna` | GPT-6 Luna | chat | ✅ | 1,048,576 | text,image | 0 |
| `mimo-2.6-pro` | MiMo 2.6 Pro | chat | ✅ | 1,048,576 | text,image | 0 |
| `crouton-alpha` | Crouton Alpha | chat | ✅ | 1,048,576 | text,image | 0 |
| `deepai-cyber` | DeepAI Cyber | chat | ✅ | 65,536 | text | 0 |
| `gpt-6.1-sol` | GPT-6.1 Sol | chat | ❌ | 1,048,576 | text,image | 10 |
| `glm-5.3` | GLM 5.3 | chat | ❌ | 1,048,576 | text | 3 |
| `kimi-k3` | Kimi K3 | chat | ❌ | 1,048,576 | text,image | 3 |
| `claude-opus-5-5` | Claude Opus 5.5 | chat | ❌ | 1,000,000 | text,image | 15 |
| `claude-fable-5-1` | Claude Fable 5.1 | chat | ❌ | 1,000,000 | text,image | 25 |
| `gpt-6-astra` | GPT-6 Astra | **openai-responses** | ❌ | 1,048,576 | text,image | 50 |

### 1.7 已知坑

1. 思维链在 `reasoning` 字段（参考实现会再补一份 `reasoning_content`）；magpie 原生渲染该字段（§4 #8 已实测），**无需** SSE 补写。
2. `models` 响应的默认模型字段名是 `default`（不是 `default_model`）。
3. SSE 同一事件可能有多行 `data:`，按规范用 `\n` 拼接后再解析。
4. 无效 Key 会 302 跳登录页——所有请求必须禁止跟随重定向。
5. `prompt_cache_key`（body）与 `X-Session-Affinity`（头）都影响上游调度。

---

## 2. 网关（默认模式，本机 DeepAICode2API）

### 2.1 免鉴权端点

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/ping` | `pong` |
| GET | `/health`、`/healthz` | `{status, accounts, ready, models, default_model, machine_id, machine_ready}` |

`/health` 是插件"发现网关"的依据（登录时用它给出"已发现网关：N 账号 / M 模型"）。

### 2.2 数据面（`/v1/*`）

鉴权规则（`withAuth`）：

- **已签发密钥**：所有来源强制校验 `Authorization: Bearer <key>` 或 `x-api-key: <key>`；
- **未签发密钥**：本机回环放行；非回环返回 `503 setup_required`；
- 未设密钥的本机网关因此可以"零配置"直接用。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/models` | OpenAI list，每条带 `deepai` 元信息（见下） |
| POST | `/v1/chat/completions` | Chat Completions（流式/非流式，支持 tools、图片、`prompt_cache_key`） |
| POST | `/v1/responses` | OpenAI Responses |
| POST | `/v1/messages` | Anthropic Messages（插件不直接用） |
| GET | `/v1/deepai/theos` | `{account, username, theos:{…}}`（**单号视角**，从池里取一个） |
| GET | `/v1/deepai/usage` | `{account, username, usage:{…}}` |

`/v1/models` 的 `deepai` 元信息字段：
`{name, reasoning, input, context_window, max_tokens, premier, free, api, theos_per_request}`。

### 2.3 管理面（`/admin/api/*`）

鉴权（`withAdminAuth`）：

- 设了管理密码 → 必须 `X-Admin-Password: <pw>` 或 Bearer；
- 没设 → 仅回环；
- **写操作要同源**（`Origin` 头必须为空或与 Host 一致）。插件从 Bun 发出的请求没有 `Origin` → 视为同源。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/api/overview` | `{accounts, ready, keys, models, default_model, models_updated, machine_id, settings, stats, upstream}`（带 ETag） |
| GET | `/admin/api/accounts?offset&limit` | `{items, total, offset, limit}`；`items[].theos` 与 `last_err` 是池级额度的数据源 |
| POST | `/admin/api/checkin` | `{ok, results:[{id,name,ok,err,theos}]}`；内部 4 并发探测 `/theos` |
| 其它 | `state/keys/logs/stats/settings/models/register` | 插件不使用（不做写操作） |

### 2.4 错误体

```json
{"error":{"message":"…","type":"invalid_request_error|server_error|setup_required","code":<HTTP 状态整数>}}
```

### 2.5 池空语义

推理类端点在没有可用账号时返回 `503 {"error":{"message":"没有可用账号"}}`；
`/v1/models` 仍返回缓存目录（启动时从上游拉取，**不需要任何账号**）。

插件把"池空"映射成 429（触发 magpie 换号），把 `setup_required` 保持 503（配置问题）。

---

## 3. 额度窗口的构造约定

magpie 的 `auth.usage` 约定：

- 厂商没给用量时**不要传 `used`**，也不要用 0 表示"不知道"；
- 有 `amount` + `limit` 时 magpie 自己算 `used = limit - amount`；
- `aside: true` 的窗口只展示、不参与路由；本插件默认 `aside: false`（余额多的账号优先）。

因此：

| 模式 | 窗口 | 何时给 amount/limit |
|---|---|---|
| gateway | 号池额度（Σbalance / Σgranted，账号数） | `Σgranted > 0` |
| direct | 今日 Theos（balance / granted） | `granted > 0` |

`rate` 与 `free` 的语义（magpie）：

- `free: true` 才算免费；`rate: 0` 表示"没给倍率"，不是免费；
- 上游 `theosPerRequest == "0"` → `free: true`；其它数值 → `rate`。

---

## 4. 验证状态（2026-11-06 真机实测）

| # | 项目 | 状态 | 结论 |
|---|---|---|---|
| 1 | 上游 SSE 思维链字段 | ✅ 实测 | `delta` 里有 `reasoning` 与 `reasoning_details`，**没有** `reasoning_content`；magpie 已确认原生透传渲染（见 #8） |
| 2 | 工具调用 | ✅ 实测 | `tool_choice: "required"` + `max_tokens: 512` → `finish_reason: "tool_calls"`、`get_weather` 参数正确；`max_tokens: 64` 时会被思维链吃光，属正常现象 |
| 3 | 图片输入 | ✅ 实测 | `image_url` + 1×1 PNG → 200，模型正确描述颜色 |
| 4 | 模型级 npm 覆盖（`gpt-6-astra`） | ✅ 实测 | `magpie plugin --json` 里该模型为 `npm: @ai-sdk/openai`；mock 网关的 `provider test` 走通了 Responses 通道 |
| 5 | `api` 方式必须有非空 Key | ✅ 实测 | magpie 要求提示里有一个非空 Key；插件用哨兵值处理"无密钥网关"（`loopback`）与"自动读凭据"（`auto`），见 README |
| 6 | 插件 fetch 的 URL 形状 | ✅ 实测 | magpie 拼成 `{baseURL}/chat/completions` 或 `{baseURL}/responses`；插件的路径重建与之兼容（重复 `/v1` 也能纠正） |
| 7 | 网关管理接口在"无密码 + 回环"时开放 | ✅ 实测 | 空密码网关的 `/admin/api/*` 从回环可直接读；插件因此改为"先试，401/403 再降级" |
| 8 | **magpie 是否展示 `reasoning`** | ✅ 实测 | 2026-11-06 晚真实 Agent 会话（`deepseek-v4.1-flash`）：「思考 · 持续 4 秒」块正常渲染 → magpie 原生展示上游 `reasoning`；SSE 行级补写**不需要启用**（预留位置保留，仅备宿主行为变化） |
| 9 | 浏览器登录 `desktop_auth` 的 `state`/`port` 规则 | ❓ 未验证 | 未做浏览器实登；`localhost` 回调与 code 降级已由单测覆盖 |

## 5. 真机实测记录（2026-11-06）

本机环境：magpie 0.1.2863；DeepAI Code 桌面端已登录（账号名已脱敏）；
参考网关用本仓库源码 `go build` 后以独立 data 目录 / 端口启动。

| 动作 | 结果 |
|---|---|
| 网关启动（空号池 → 自动导入桌面端凭据） | `/health` 200；`/v1/models` 14 个；`/deepai_code/models` 上游同步成功 |
| `/v1/deepai/theos`（真实账号） | `enabled:true, balance:"200.00000", granted:"200.00000", refresh_at:"2026-11-07T13:26:49Z"` |
| 插件登录（网关模式，无 Key 网关） | `✓ signed in`；`quota` 显示「池 · 1/1 可用」「剩 200 / 200 theos」 |
| 插件登录（直连模式，读桌面端凭据） | `✓ signed in`；`quota` 显示「free · <账号名已脱敏>」「剩 200 / 200 theos」 |
| `magpie provider test deepaicode glm-5.3-flash`（网关） | ✓ chat 21,037 ms（上游冷启动；第二次 smoke 为热路径） |
| `magpie provider test deepaicode glm-5.3-flash`（直连） | ✓ chat 686 ms |
| 钩子级 smoke（真网关，流式） | 200 `text/event-stream`，4 个 chunk，见到 `[DONE]`；usage/checkin 正常 |
| 工具调用（直连上游） | `finish_reason: tool_calls`，参数 `{"city":"巴黎"}` |
| 图片输入（直连上游） | 200，模型回答「鲑鱼色（橙粉色/珊瑚色）」 |
| Agent 真实会话（`deepseek-v4.1-flash`，2026-11-06 晚） | 正常回复；「思考 · 持续 4 秒」块正常渲染 → magpie 原生展示 `reasoning`（§4 #8） |

**额度口径实测**：免费模型（`theosPerRequest: "0"`）的响应里 `cost` 为 0；200 Theos 是 premier 模型的额度，
所以本轮回测没有消耗 Theos。

**一个环境坑**：如果 shell 里设了 `HTTPS_PROXY`（本机 Clash `127.0.0.1:7897`），Node 的 `fetch` 默认不读代理由，
探针脚本会超时；加 `NODE_USE_ENV_PROXY=1` 即可（Node 24+）。magpie 的 Bun 宿主与 Go 网关都读环境代理，所以
`provider test` 不受影响。

## 6. 尚未验证的项（实现已留降级路径）

| # | 未验证项 | 现有处理 | 验证方式 |
|---|---|---|---|
| 1 | 浏览器登录 `desktop_auth` 的 `state`/`port` 校验规则（上游是否接受任意回环端口、回调是否带 state） | 回调"有 state 就校验、没有就只认路径与一次性端口"；监听失败或超时降级为粘贴 `code` | 真机走一次浏览器登录 |

---

## 7. 复现方法

```bash
# 1) 协议取证（脱敏，不写文件）
node scripts/probe.mjs --mode gateway --url http://127.0.0.1:10087 --admin <pw>
node scripts/probe.mjs --mode direct  --secret-dir ~/.deepai-code

# 2) 离线联调（不需要真网关/真账号）
node scripts/mock-gateway.mjs --port 10099 --accounts 3

# 3) 单元测试
npm test

# 4) 起一个真网关做契约回归（空号池即可验证 models/health/admin 面）
#    git clone https://github.com/2951461586/DeepAICode2API
#    go build -o deepaicode2api.exe . && DEEPAI2API_PORT=10099 ./deepaicode2api.exe
```

关键取舍：插件对上游/网关的**错误原话一律透传**，自己的文案只用于"该怎么处理"；因此上游变更时，agent 与日志里能看到原话，不会被插件吞掉。
