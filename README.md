# dsh-opencode-session

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
compatibility plugin that sends the `x-opencode-session` header the opencode.ai
gateway requires on `opencode` / `opencode-go` routes.

## The problem

The Console Go gateway rejects requests without an `x-opencode-session` header:

```
400: {"type":"MissingSessionID","message":"Error from provider (Console Go):
Request is missing x-opencode-session and cannot be routed efficiently. Please
see https://opencode.ai/docs/go/#where-can-i-use-it"}
```

The header names the conversation so the gateway can route the request to the
node holding that conversation's cache. The pi coding agent sends it from its
provider-attribution layer; the shared library dsh uses for these routes
(`@earendil-works/pi-ai` 0.85.1) does not implement it yet, so every
opencode / opencode-go model call started from dsh fails.

This plugin restores parity.

## Install

```bash
# from npm (once published)
dsh plugin --profile web add dsh-opencode-session

# straight from GitHub
dsh plugin --profile web add github:BrackRat/dsh-opencode

# from a local checkout or tarball
dsh plugin --profile web add /path/to/dsh-opencode
dsh plugin --profile web add ./dsh-opencode-session-0.1.0.tgz
```

Because the package declares `dsh.bundle`, `dsh plugin add` adds it to
`dsh.profile.bundles` automatically — no manual profile edit. Restart
`dsh web` afterwards.

## Verify

```bash
dsh --profile web --dump-config | grep -A 2 opencode-session-header
```

The composed tree should show the plugin entry, and a chat on an
opencode-go model should answer instead of returning `MissingSessionID`.

## Uninstall

```bash
dsh plugin --profile web remove dsh-opencode-session
```

## How it works

- The plugin registers on dsh's `llm/stream` waterfall, the documented
  interception point for model calls.
- On every request it resolves the live pi-ai `Models` instance from the
  adapter about to serve that request — so it patches the exact module
  instance in play — and installs one wrapper per prototype (idempotent,
  process-lifetime).
- The wrapper injects `x-opencode-session: <session id>` and
  `x-opencode-client: dsh` into the request options for `opencode`,
  `opencode-go`, or any model whose base URL is hosted on `opencode.ai` — the
  same predicate the pi coding agent uses.
- pi-ai merges `options.headers` last in every wire protocol
  (`openai-completions`, `anthropic-messages`, `openai-responses`), so a header
  you configure explicitly on the provider or the model always wins.
- Nothing on disk is modified: the wrapper lives in memory and re-installs
  itself on every boot, so dsh upgrades and plugin reinstalls need no action.
- Fail-safe: if a future dsh or pi-ai build changes the internals, the plugin
  logs a warning and steps aside; it never fails a request.

## Compatibility

Validated on dsh `0.1.5-rc.1` with `@earendil-works/pi-ai` `0.85.1`.

When pi-ai implements the header itself this plugin can be removed; if you
leave it installed it becomes a no-op for requests that already carry the
header.

## Development

```bash
npm test        # node:test, no dependencies
npm pack        # inspect the published file set
```

## License

MIT
