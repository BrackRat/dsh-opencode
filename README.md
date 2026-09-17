# dsh-opencode-session

![dsh-opencode — DeepSeek Harness plugin that fixes opencode.ai's 400 MissingSessionID by sending the x-opencode-session header on opencode / opencode-go routes](assets/Social_Preview.png)

[![test](https://github.com/BrackRat/dsh-opencode-session/actions/workflows/test.yml/badge.svg)](https://github.com/BrackRat/dsh-opencode-session/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.1.5--rc.1-blue)](https://github.com/deepseek-ai/deepseek-harness)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
plugin that fixes the **`400 MissingSessionID`** error returned by opencode.ai's
gateway (Console Go) — it sends the `x-opencode-session` header on every
`opencode` / `opencode-go` request.

**Search terms**: `dsh plugin` · `DeepSeek Harness` · `opencode` · `opencode-go` ·
`x-opencode-session` · `MissingSessionID` · `Console Go` · `400` ·
`cannot be routed efficiently` · `pi-ai` · `dsh-plugin`

## The problem

Since the Console Go gateway started requiring a session header, every
`opencode` / `opencode-go` model call started from dsh fails with:

```
400: {"type":"MissingSessionID","message":"Error from provider (Console Go):
Request is missing x-opencode-session and cannot be routed efficiently. Please
see https://opencode.ai/docs/go/#where-can-i-use-it"}
```

The header names the conversation so the gateway can route the request to the
node holding that conversation's cache. The pi coding agent sends it from its
provider-attribution layer; the shared library dsh uses for these routes
(`@earendil-works/pi-ai` 0.85.1) does not implement it yet, so the error is
specific to dsh.

This plugin restores parity.

## Install

```bash
# from GitHub (works today)
dsh plugin --profile web add github:BrackRat/dsh-opencode-session

# from npm (once published)
dsh plugin --profile web add dsh-opencode-session

# from a local checkout or tarball
dsh plugin --profile web add /path/to/dsh-opencode
dsh plugin --profile web add ./dsh-opencode-session-0.1.0.tgz
```

Because the package declares `dsh.bundle`, `dsh plugin add` adds it to
`dsh.profile.bundles` automatically — no manual profile edit. Restart
`dsh web` afterwards.

## FAQ

### Does this fix `400 MissingSessionID` from `dsh web`?

Yes. Install the plugin and restart the dsh process that serves your UI; every
following `opencode` / `opencode-go` request carries the header and the gateway
routes it normally.

### Why does the pi coding agent work while dsh fails?

pi adds `x-opencode-session` (plus `x-opencode-client: pi`) in its own
provider-attribution layer for `opencode` / `opencode-go`. dsh reaches the same
gateway through `@earendil-works/pi-ai`, which does not implement that header
yet. This plugin supplies the missing piece inside dsh.

### Does it patch files, credentials, or settings?

No. It is a normal dsh plugin bundle: it installs into the profile, registers
one `llm/stream` middleware, and wraps the live pi-ai `Models` prototype in
memory. Nothing outside the dsh process is modified, and the wrapper re-installs
itself on every boot, so dsh upgrades need no action. Uninstalling removes every
trace.

### Which routes and models does it cover?

`opencode`, `opencode-go`, and any model whose base URL is hosted on
`opencode.ai` — the same predicate the pi coding agent uses. Other providers
(DeepSeek official, Anthropic, OpenAI, …) are untouched.

### Will it conflict with a header I configured myself?

No: an `x-opencode-session` you set on the provider or the model wins; the
plugin only fills the gap when the header is absent. Once pi-ai implements the
header itself, this plugin becomes a no-op and can be removed.

### Is it tested?

9 unit tests (`node --test`, zero dependencies) cover the predicate, the header
precedence rules, the prototype wrapper, and the fail-safe path, plus an
end-to-end check against a live `opencode-go` model during development.

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
  `x-opencode-client: dsh` into the request options for the opencode routes.
- pi-ai merges `options.headers` last in every wire protocol
  (`openai-completions`, `anthropic-messages`, `openai-responses`), so a header
  you configure explicitly always wins.
- Fail-safe: if a future dsh or pi-ai build changes the internals, the plugin
  logs a warning and steps aside; it never fails a request.

## Compatibility

Validated on dsh `0.1.5-rc.1` with `@earendil-works/pi-ai` `0.85.1`
(DeepSeek V4 Pro / V4 Flash on `opencode-go`, `openai-completions` protocol).

## Development

```bash
npm test        # node:test, no dependencies
npm pack        # inspect the published file set
```

## License

MIT
