---
type: Policy
title: Security boundaries
description: Same-origin guard on socket access; client-side page content treated as data, not code
tags: [security, same-origin, csrf, data-handling]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: stable
sources:
  - resource: ../README.md
  - resource: ../docs/stack.md
---

## Implemented Guards

**Same-origin check** (`src/http.ts`, `src/server.ts`): `isSameOrigin(headers)` returns true if `Sec-Fetch-Site: same-origin` or `Origin` header host matches `Host`; server rejects 403 otherwise. No fallback for Safari without `Sec-Fetch-Site` (older versions treated as same-origin violations). Deliberately no auth token: a same-origin request is one the served page made, and a token adds secret management overhead with no additional safety (dev server is trusted by definition of serving the page).

**Request body guards** (`src/http.ts`):
- Content-Type must be `application/json`, reject 415 otherwise.
- Body size cap: 256 KB (262144 bytes), reject 413 without destroying the socket (async iterator's `return()` handles TCP RST internally; explicit `destroy()` would leave unread bytes and trigger the OS to send RST).
- JSON parse validation, reject 400 on invalid JSON.

**Prompt validation** (`src/http.ts`):
- `validatePrompt(body)` enforces type shape: `target` (non-empty string), `prompt` (max 20000 chars), `element` (object with url, path, html, hint, viewport, rect, styles).
- Returns null (never throws) on mismatch; server responds 400 `invalid_params`.

**Attachment storage** (`src/server.ts`):
- Oversized snippets go to `os.tmpdir()/vite-plugin-herdr/`.
- `cleanupAttachments(dir, maxAgeMs)` deletes `.md` files older than 24 hours (86400000 ms), ignores missing directory and per-file errors, runs on startup.
- No secrets in attachments (user prompts sent in request body, not files).

## Edge Cases

- **iframe picked as element**: Accepted, treated as target element.
- **Shadow DOM**: Open roots traversed; closed roots stop at host.
- **SVG**: Hit inside `<svg>` bubbles up to `<svg>` tag, not the tag inside it.
- **Base path != /**: Vite handles script injection; server-side routes mount under `server.config.base`.
- **Cross-origin images in snippet**: Not requested by server (no fetch); only copied from the page's own render cache.

No CSRF tokens needed: socket address is private to herdr pane env. Picker state is local to the page (no persistent session).
