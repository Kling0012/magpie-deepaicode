# Security

## Reporting

Open an issue at https://github.com/aqiu817/magpie-deepaicode/issues (or a private
security advisory if the repository offers one). Please do not include real API keys or
credential files in reports — the probe script already masks them.

## Credential handling

| Data | Where it lives | Who can read it |
|---|---|---|
| DeepAI API key | magpie's `plugin-auth.json` (mode 0600 on POSIX) | magpie + the plugin host process |
| DeepAI desktop credential | `~/.deepai-code/userdata/secrets/deepai-account.bin` (the app's own plaintext JSON) | the user's account only |
| Gateway key / admin password | magpie's `plugin-auth.json` as account metadata | magpie + the plugin |
| Machine fingerprint | derived on the fly from the key (no storage) | — |

Nothing is written outside magpie's config directory. The desktop credential file is
opened read-only.

## Network boundaries

- Request URLs are **rebuilt from the configured base** (`http://127.0.0.1:10087/v1` or
  `https://api.deepai.org/deepai_code`). The host in the incoming URL is only used to
  decide chat vs responses; it is never contacted.
- Redirects are refused. An invalid key makes upstream respond `302` to its sign-in page;
  following it would turn an authentication failure into a fake `200`.
- Keys are sent as `Api-Key` (direct) or `Authorization: Bearer` (gateway) — never in
  query strings, never in logs.
- Error messages are passed through from the vendor; plugin-generated text never includes
  key material.
- Non-streaming JSON reads are capped (1 MiB); streaming bodies are passed through without
  buffering.

## Out of scope

The plugin does not manage the gateway process, does not register accounts, and does not
accept connections from the network — the browser sign-in helper listens on
`127.0.0.1` only, on a random port, for one callback.
