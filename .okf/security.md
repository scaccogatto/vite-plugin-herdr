---
type: Policy
title: Security boundaries
description: Loopback, proxy header and same-origin guards on socket access; client-side page content treated as data, not code
tags: [security, loopback, same-origin, csrf, data-handling]
generated:
  by: claude/fable-5
  at: 2026-10-13
status: stable
sources:
  - resource: ../README.md
  - resource: ../docs/stack.md
---

## Implemented Guards

**Loopback check** (`src/http.ts`, `src/server.ts`): `isLoopbackAddress(req.socket.remoteAddress)` accepts only `127.0.0.0/8`, `::1` and `::ffff:127.x.x.x`; the server rejects anything else with 403 before any other check, unless the `allowRemote` option is `true`. This is the network boundary: the TCP peer address is the one input a client cannot choose, so `vite --host` or a container port mapping no longer exposes `/prompt` and `/spawn` (arbitrary text into agents that run shell commands) to the network.

**Proxy header check** (`src/http.ts`, `src/server.ts`): HTTP tunnels (ngrok, cloudflared, VS Code port forwarding) and local reverse proxies connect to the dev server from loopback, so `isLocalRequest(address, headers)` also requires that none of `PROXY_HEADERS` (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`) is present. Known gap: a plain TCP forwarder (`ssh -R`, `socat`) adds no headers and looks exactly like a local client, so it is not covered and the docs tell users not to expose the dev server that way.

**Same-origin check** (`src/http.ts`, `src/server.ts`): `isSameOrigin(headers)` returns true if `Sec-Fetch-Site: same-origin` or `Origin` header host matches `Host`; server rejects 403 otherwise. This is a browser (CSRF) guard only: non-browser clients set both headers freely. No fallback for Safari without `Sec-Fetch-Site` (older versions treated as same-origin violations). Deliberately no auth token: a loopback, same-origin request comes from the served page or from a local process that could already reach the herdr socket directly, so a token adds secret management overhead with no additional safety.

**Request body guards** (`src/http.ts`):
- Content-Type must be `application/json`, reject 415 otherwise.
- Body size cap: 256 KB (262144 bytes), reject 413 without destroying the socket (async iterator's `return()` handles TCP RST internally; explicit `destroy()` would leave unread bytes and trigger the OS to send RST).
- JSON parse validation, reject 400 on invalid JSON.

**Prompt validation** (`src/http.ts`):
- `validatePrompt(body)` enforces type shape: `target` (non-empty string), `prompt` (max 20000 chars), `element` (object with url, path, html, hint, viewport, rect, styles).
- Returns null (never throws) on mismatch; server responds 400 `invalid_params`.

**Attachment storage** (`src/server.ts`):
- Oversized snippets and screenshots go to `os.tmpdir()/vite-plugin-herdr-<uid>/` (the uid suffix keeps users sharing `/tmp` apart). `ensurePrivateDir` creates it with mode 0700, refuses a symlink or a directory owned by another user, and tightens a pre-existing directory with group or other bits; attachment files are written with mode 0600 and `O_EXCL`.
- `cleanupAttachments(dir, maxAgeMs)` deletes `.md` files older than 24 hours (86400000 ms), ignores missing directory and per-file errors, runs on startup.
- No secrets in attachments (user prompts sent in request body, not files).

## Edge Cases

- **iframe picked as element**: Accepted, treated as target element.
- **Shadow DOM**: Open roots traversed; closed roots stop at host.
- **SVG**: Hit inside `<svg>` bubbles up to `<svg>` tag, not the tag inside it.
- **Base path != /**: Vite handles script injection; server-side routes mount under `server.config.base`.
- **Cross-origin images in snippet**: Not requested by server (no fetch); only copied from the page's own render cache.

No CSRF tokens needed: socket address is private to herdr pane env. Picker state is local to the page (no persistent session).
