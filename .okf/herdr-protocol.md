---
type: Protocol
title: Herdr integration facts
description: Tested with herdr 0.8.2, protocol version 20; socket NDJSON in $HERDR_SOCKET_PATH
tags: [herdr, protocol, socket, ndjson, environment]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
---

## Verified Facts (2026-09-07, herdr 0.8.2)

**Socket location**: `$HERDR_SOCKET_PATH` environment variable; fallback `~/.config/herdr/herdr.sock`.

**Protocol**: NDJSON (one JSON object per line). Methods: `session.snapshot` (returns version, protocol, workspace list, agent list), `agent.list` (agents unfiltered), `agent.prompt {target, text}` (sends prompt, rejects `blocked` agents).

**Agents**: Hand-started agents have no `name` field; address by `pane_id`. Read from `session.snapshot`.

**Multiline**: `agent.prompt` handles multiline text.

**Environment in panes**: `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` (set when running inside herdr).

## Server Bridge

Dev server (Node.js):

- Single connection per request (no persistent socket connection).
- `resolveSocketPath()`: env var, then default.
- `request(socketPath, method, params, timeoutMs)`: send JSON, parse reply line, close.
- Error handling: `HerdrError { code }` for protocol errors; `httpStatus(code)` maps to HTTP response.

Errors: timeout, ENOENT (socket missing), protocol error (can't parse JSON), agent blocked (409 → `Conflict`), agent not found (404 → `Not Found`).

## Endpoint Guards

`isSameOrigin(req.headers)`: check `Sec-Fetch-Site: same-origin` or `Origin` host matches `Host`. Reject 403 if missing or mismatch. Fallback: Safari old versions without `Sec-Fetch-Site` receive 403.

Windows: `HERDR_SOCKET_PATH` required; socket APIs differ. Clipboard fallback on failure.
