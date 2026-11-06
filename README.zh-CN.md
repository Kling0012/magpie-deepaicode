# magpie-deepaicode

把 **DeepAI Code** 的模型接入 magpie：所有 Agent 都能以 `deepaicode/<模型>` 使用。
默认直连 `https://api.deepai.org/deepai_code`，每个账号一个独立机器指纹；
也支持本机 [DeepAICode2API](https://github.com/2951461586/DeepAICode2API) 网关，
但它的登录方式默认隐藏（见「选项」）。

> 状态：v0.1.1 —— 75 个单测全绿。2026-11-06 已在真实账号上完成回归：
> 对话、流式、工具调用、图片输入均可用；额度与签到读到真实值。
> 上游思维链在 `reasoning` 字段，magpie 是否展示仍在观察（PROTOCOL.md §4）。

## 安装

```bash
magpie plugin add magpie-deepaicode            # 发布到 npm 后
magpie plugin add github:aqiu817/magpie-deepaicode
magpie plugin add ./magpie-deepaicode          # 本地文件夹
```

应用里：**插件 → 添加插件** → 填文件夹路径或包名。

## 登录

`magpie plugin login deepaicode` 提供四种方式：

| 方式 | 需要什么 | 说明 |
|---|---|---|
| **浏览器登录 DeepAI**（推荐） | 一个 DeepAI 账号 | 打开 `desktop_auth`，在随机 `127.0.0.1` 端口等回调，换回 Key；监听失败时降级为粘贴回调里的 `code` |
| **读取本机 DeepAI Code 凭据** | DeepAI Code 桌面端登录过一次 | 读 `~/.deepai-code/userdata/secrets/deepai-account.bin`（明文 JSON）；Key 提示填 **`auto`**（也可以直接粘贴 Key 改用粘贴的值） |
| **粘贴 API Key** | 一个 DeepAI API Key（UUID 形态） | 保存前先用 `/theos` 验活 |

`auto` 是哨兵值，表示"读桌面端凭据"（magpie 对 `api` 方式要求 Key 非空）。
`loopback` 哨兵属于下面可选的网关登录。

> 终端提示：插件的提问之后，magpie 还会从 stdin 再读一个 Key。插件自己返回了 Key
> （桌面端 / 浏览器）时这个值会被忽略——随便填。应用里的流程只显示插件的提示。

**可选：本机网关。** 跑着 DeepAICode2API 的用户可以打开第四个登录方式：

```bash
magpie plugin options magpie-deepaicode '{"showGatewayLogin": true}'
```

它会问网关地址（默认 `http://127.0.0.1:10087`）、网关 Key（**网关没签发密钥时填
`loopback`**）、可选管理密码（有密码才能看池级额度与签到）。网关账号与直连账号可以并存。

## 使用

```
deepaicode/glm-5.3-flash          # 免费模型（2026-11-06 快照：14 个里 8 个免费）
deepaicode/claude-opus-5-5        # premier 模型，消耗 Theos
deepaicode/gpt-6-astra            # 仅 Responses 通道
```

模型目录动态拉取（`/v1/models` 或 `/deepai_code/models`），拉不到时用 2026-11-06 快照兜底。
`theosPerRequest == "0"` → magpie 的 `free: true`；premier 的价格（3/10/15/25/50）→ `rate`。

`gpt-6-astra` 用模型级 npm 覆盖（`@ai-sdk/openai`），magpie 会把它发往 Responses 端点。

## 额度与签到

- **直连模式（默认）**：额度 = 该账号的 `/theos` + `/get_usage_summary`；
  签到 = 调一次 `/theos` 触发并锁定当日额度，用 `refresh_at` 变化判断"刚领到"。
- **网关模式（可选）**：额度 = 池级聚合（`/admin/api/accounts`）：有额度账号数、
  Σbalance / Σgranted、最早的 `refresh_at`；签到 = `POST /admin/api/checkin`
  （需要管理密码，或没设密码的回环网关）。

每日免费 Theos 按 **(机器指纹, 账号)** 每天发一次。插件给每个 Key 派生稳定的独立指纹
（`uuidv5(sha256(key))`），多个账号不会互相抢同一份每日额度；想和桌面端共享同日额度可设
`machineMode: "device"`。

## 选项

通过插件选项传入（应用里「已安装 → 选项」，或 `magpie plugin options deepaicode '<json>'`）：

| 选项 | 默认 | 含义 |
|---|---|---|
| `mode` | `direct` | 新登录账号的默认模式（`direct` \| `gateway`） |
| `showGatewayLogin` | `false` | 显示"本机 DeepAICode2API"登录方式 |
| `gatewayUrl` | `http://127.0.0.1:10087` | 网关地址（网关模式） |
| `gatewayKey` | `""` | 共享的网关 Key（网关模式；通常按账号存） |
| `gatewayAdmin` | `""` | 管理密码（网关模式的池级额度与签到） |
| `baseOrigin` | `https://api.deepai.org` | 直连上游地址 |
| `laneVersion` | `"2"` | `X-DeepAI-Code-Theos` 车道版本；只有上游报 426 时才需要改 |
| `machineMode` | `account` | `account` \| `device`（仅直连模式） |
| `secretDir` | `""` | 桌面端凭据目录（留空自动探测） |
| `lang` | `zh` | 界面语言（`zh` \| `en`） |
| `debug` | `false` | 输出详细日志（magpie 里显示为 `plugin: …`） |

## 排查

**"网关未响应"** —— 先启动 DeepAICode2API，或改用直连账号登录。

**"网关拒绝了请求"** —— 网关已签发密钥，去控制台（`http://127.0.0.1:10087/`）复制一个。

**"号池暂无可调度账号"** —— 网关号池是空的；用 `register.exe` 或控制台补号，或改用直连。

**自己的 DeepAI 账号登录失败** —— 先跑探针，它会打印状态码与上游原话（Key 已脱敏）：

```bash
node scripts/probe.mjs --mode direct --secret-dir ~/.deepai-code
```

如果探针超时但 magpie 自己能连上游，说明系统设了代理而 Node 的 `fetch` 默认不读代理：
用 `NODE_USE_ENV_PROXY=1` 重跑（Node 24+）。magpie 的 Bun 宿主与 Go 网关都会读 `HTTPS_PROXY`。

| 探针输出 | 最可能的原因 | 怎么办 |
|---|---|---|
| `403` / `email_unverified` | 邮箱未验证 | 点验证链接；网关的 `register -reverify` 可补发 |
| `401` | Key 失效（重新登录会换 Key） | 桌面端重新登录，或粘贴新 Key |
| 网页能登、API 立刻 `302`/`401` | 读到旧凭据 | 重新读取桌面端凭据文件 |
| `426` | 车道版本不对 | 把 `laneVersion` 改成上游要求的值 |

**Agent 看不到思考内容** —— 上游把思维链放在 `reasoning`；magpie 未必透出。
这条记录在 `PROTOCOL.md` §4，属于待验证项。

## 安全

- DeepAI Key **只**发往配置的网关/上游；请求 URL 一律从配置的基地址重建，不会跟随传入 URL 的主机。
- 拒绝重定向（`redirect: "error"`）：无效 Key 不能被 302 到登录页"伪装成 200"。
- Key 不出现在日志或错误文案里；探针输出做了脱敏。
- 非流式响应有大小上限；流式响应原样透传，不缓冲、不改内容。
- 桌面端凭据只读；除 magpie 自己的登录存储外，插件不写任何凭据。

## 开发

```bash
npm test                                  # node --test（74 个用例）
node scripts/mock-gateway.mjs --port 10099 # 离线网关，供 provider test / quota 联调
node scripts/smoke.mjs --url http://127.0.0.1:10099   # 直接调钩子：models/usage/checkin/loader
node scripts/probe.mjs --mode gateway --url http://127.0.0.1:10099
```

协议事实与证据等级见 [PROTOCOL.md](./PROTOCOL.md)。

## 许可

MIT。协议知识来自 DeepAICode2API（MIT），见 [NOTICE](./NOTICE)。
