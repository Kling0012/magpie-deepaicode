# magpie-deepaicode

A magpie provider plugin that makes **DeepAI Code** models available to every agent as
`deepaicode/<model>`. By default it talks to DeepAI directly
(`https://api.deepai.org/deepai_code`), with one independent machine fingerprint per account.
A local [DeepAICode2API](https://github.com/2951461586/DeepAICode2API) gateway is also
supported, but its sign-in method is hidden by default (see *Options*).

> Status: v0.1.1 — 75 unit tests green; real-account regression on 2026-11-06:
> chat, streaming, tool calls and image input all work; quota and check-in read live values.
> Upstream thinking arrives in `reasoning`; whether magpie renders it is still being
> observed (PROTOCOL.md §4).

## Install

```bash
magpie plugin add magpie-deepaicode            # npm (when published)
magpie plugin add github:aqiu817/magpie-deepaicode
magpie plugin add ./magpie-deepaicode          # a local folder
```

In the app: **Plugins → Add plugin** → paste the folder path or package name.

## Sign in

`magpie plugin login deepaicode` offers four methods:

| Method | Needs | Notes |
|---|---|---|
| **Sign in with DeepAI** (recommended) | a DeepAI account | opens `desktop_auth`, listens on a random `127.0.0.1` port for the callback, exchanges the code; falls back to pasting the `code` if it cannot listen |
| **Read desktop credentials** | the DeepAI Code desktop app signed in once | reads `~/.deepai-code/userdata/secrets/deepai-account.bin` (plaintext JSON); in the key prompt type **`auto`** (or paste a key to use that instead) |
| **Paste API key** | a DeepAI API key (UUID form) | validated against `/theos` before it is saved |

`auto` is a sentinel meaning "read the desktop credentials" (magpie requires a non-empty
key prompt for `api` methods). The `loopback` sentinel belongs to the optional gateway
sign-in, described below.

> Terminal note: after the plugin's questions magpie reads one more key from stdin. When the
> plugin returns a key itself (desktop / browser), that extra value is ignored — type anything.
> The in-app flow shows the plugin's own prompts.

**Optional: local gateway.** Users who run DeepAICode2API can expose a fourth method with:

```bash
magpie plugin options magpie-deepaicode '{"showGatewayLogin": true}'
```

It asks for the gateway URL (default `http://127.0.0.1:10087`), the gateway key (**type
`loopback` when the gateway has issued none**) and an optional admin password (unlocks
pool-wide quota and check-in). Gateway accounts and direct accounts can coexist.

## Use

```
deepaicode/glm-5.3-flash          # free models (8 of 14 as of 2026-11-06)
deepaicode/claude-opus-5-5        # premier models spend Theos
deepaicode/gpt-6-astra            # Responses-only model
```

The catalog is fetched dynamically (`/v1/models` or `/deepai_code/models`), with a
2026-11-06 snapshot as fallback. `theosPerRequest == "0"` becomes magpie's `free: true`;
premier prices (3/10/15/25/50) become `rate`.

`gpt-6-astra` uses a per-model npm override (`@ai-sdk/openai`) so magpie sends it to the
Responses endpoint.

## Quota and check-in

- **direct mode (default)**: quota = `/theos` + `/get_usage_summary` for that account.
  Check-in = one `/theos` call, which triggers and locks the daily grant; `refresh_at`
  changes identify a freshly claimed grant.
- **gateway mode (optional)**: quota = pool aggregate (`/admin/api/accounts`): accounts with
  quota, Σbalance / Σgranted, earliest `refresh_at`. Check-in = `POST /admin/api/checkin`
  (requires the admin password, or a loopback gateway without one).

The daily free Theos is issued **once per (machine fingerprint, account) per day**. The
plugin derives a stable fingerprint per API key (`uuidv5(sha256(key))`), so several
accounts do not compete for the same daily grant. Set `machineMode: "device"` to use the
real device fingerprint instead (matches the desktop app).

## Options

Pass as the plugin's `options` (Plugins → installed → options, or
`magpie plugin options deepaicode '<json>'`):

| Option | Default | Meaning |
|---|---|---|
| `mode` | `direct` | default mode for new sign-ins (`direct` \| `gateway`) |
| `showGatewayLogin` | `false` | show the “local DeepAICode2API” sign-in method |
| `gatewayUrl` | `http://127.0.0.1:10087` | gateway base URL (gateway mode) |
| `gatewayKey` | `""` | shared gateway key (gateway mode; usually stored per account) |
| `gatewayAdmin` | `""` | admin password for pool quota / check-in (gateway mode) |
| `baseOrigin` | `https://api.deepai.org` | direct-mode upstream |
| `laneVersion` | `"2"` | `X-DeepAI-Code-Theos` lane; change only if upstream returns 426 |
| `machineMode` | `account` | `account` \| `device` (direct mode only) |
| `secretDir` | `""` | desktop credentials dir (empty = auto-detect) |
| `lang` | `zh` | UI language (`zh` \| `en`) |
| `debug` | `false` | verbose `console.error` logging (magpie shows it as `plugin: …`) |

## Troubleshooting

**"Gateway is not responding"** — start DeepAICode2API, or sign in with a direct account.

**"The gateway rejected the request"** — the gateway has issued keys; paste one from its
console (`http://127.0.0.1:10087/`).

**"No account available in the pool"** — the gateway pool is empty; add accounts with
`register.exe` or the console, or use direct mode.

**Your own DeepAI account fails to sign in** — run the probe first; it shows the status
code and the upstream's own words (masked key):

```bash
node scripts/probe.mjs --mode direct --secret-dir ~/.deepai-code
```

If the probe times out while magpie itself reaches upstream, a system proxy is set and
Node's `fetch` ignores it by default — rerun with `NODE_USE_ENV_PROXY=1` (Node 24+).
magpie's Bun host and the Go gateway both honor `HTTPS_PROXY`.

| Probe output | Likely cause | What to do |
|---|---|---|
| `403` / `email_unverified` | e-mail not verified | click the verification link; the gateway's `register -reverify` can resend it |
| `401` | key invalid (re-login rotates it) | sign in to the desktop app again, or paste the new key |
| `302`/`401` right after a successful web login | stale credential | re-read the desktop credential file |
| `426` | lane version rejected | set `laneVersion` to the value upstream expects |

**No thinking output in the agent** — the upstream puts reasoning in `reasoning`; magpie
may not expose it yet. This is tracked in `PROTOCOL.md` §4 (verification pending).

## Security

- The DeepAI key is sent **only** to the configured gateway/origin; request URLs are
  rebuilt from the configured base, never from the incoming URL.
- Redirects are refused (`redirect: "error"`): an invalid key must not be turned into a
  fake `200` by following the sign-in redirect.
- Keys never appear in logs or error messages; the probe masks them.
- Response bodies for non-streaming calls are size-limited; streaming bodies are passed
  through untouched.
- The plugin reads the desktop credential file read-only and never writes credentials
  anywhere except magpie's own auth store.

## Development

```bash
npm test                                  # node --test (74 tests)
node scripts/mock-gateway.mjs --port 10099 # offline gateway for provider test/quota
node scripts/smoke.mjs --url http://127.0.0.1:10099   # models/usage/checkin/loader, no magpie
node scripts/probe.mjs --mode gateway --url http://127.0.0.1:10099
```

Protocol facts and evidence levels: [PROTOCOL.md](./PROTOCOL.md).
Chinese README: [README.zh-CN.md](./README.zh-CN.md).

## License

MIT. Protocol knowledge derives from DeepAICode2API (MIT); see [NOTICE](./NOTICE).
