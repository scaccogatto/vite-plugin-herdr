---
type: Protocol
title: Herdr integration facts
description: Tested with herdr 0.8.2, protocol version 20; socket NDJSON in $HERDR_SOCKET_PATH
tags: [herdr, protocol, socket, ndjson, environment]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: stable
sources:
  - resource: ../docs/flows.md
  - resource: ../docs/stack.md
---

## Verified Facts (2026-09-07, herdr 0.8.2)

**Socket location**: `$HERDR_SOCKET_PATH` environment variable; fallback `~/.config/herdr/herdr.sock` (named sessions: `~/.config/herdr/sessions/<name>/herdr.sock`).

**Framing**: NDJSON over the Unix socket, one JSON object per line. Request: `{ id, method, params }`, all three required. Success reply: `{ id, result: { type, ... } }`. Error reply: `{ id, error: { code, message } }`, `code` is free-form (not an enum the client can exhaustively switch on). No auth beyond filesystem permissions on the socket path. One request per connection is the documented-safe pattern; only `events.subscribe` keeps a connection open.

**Methods used by this plugin**:
- `session.snapshot {}` → workspaces, agents (`AgentInfo`), panes, tabs, layouts, focused ids, `version`, `protocol`. This is the one call `GET /state` needs.
- `agent.prompt {target, text, wait?}` → `{ type: 'agent_prompted', agent }`. Multi-line `text` is sent as bracketed paste plus `Enter`. Rejects with `agent_blocked` if the target agent is waiting at a dialog; a `working` agent accepts and queues the input (Claude Code does this).
- `events.subscribe {subscriptions:[{type:'pane.agent_status_changed', pane_id}]}` (pane_id required per subscription, no unsubscribe, close the socket to stop). Used to watch agent status after a prompt.
- `pane.split {direction, target_pane_id, cwd?, focus?}` → `{pane}`. Used to create a sibling pane for mode "here" spawn.
- `agent.start {name, kind, pane_id, args?, timeout_ms?}` → `{agent}`. Starts an agent in an idle pane. Pane must be an idle shell.
- `worktree.create {cwd?, branch?, base?, path?, label?, workspace_id?, focus?}` → `{workspace, tab, root_pane, worktree}`. Used for mode "worktree" spawn.

**Error codes observed**: `agent_blocked`, `agent_prompt_stalled`, `not_found`, `invalid_params`, `busy`, `agent_not_ready`.

**Agents**: `AgentInfo` carries `pane_id`, `workspace_id`, `tab_id`, `agent_status` (`idle | working | blocked | done | unknown`), `focused`, `agent` (kind), `cwd`, `terminal_title_stripped`, `tokens.branch`, `agent_session`, and an optional `name`. Hand-started agents have no `name`: address by `pane_id`. Names, when present, only come from `agent.start` or `agent.rename` and match `[a-z][a-z0-9_-]{0,31}`.

**Multiline**: `agent.prompt` handles multiline text natively (bracketed paste), no client-side escaping needed.

**Environment in panes**: `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` (set only when the process is running inside a herdr pane; their absence is exactly the plugin's "no herdr" signal).

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
