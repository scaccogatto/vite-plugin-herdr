---
type: Policy
title: Security boundaries
description: Same-origin guard on socket access; client-side page content treated as data, not code
tags: [security, same-origin, csrf, data-handling]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
---

## Principles

1. **Same-origin only**: The browser client can only send to the dev server it's served from. Fetch requests carry browser origin guards (`Sec-Fetch-Site`, `Origin` header); server checks Origin host matches Host header or rejects 403.

2. **Page content as data**: HTML snippet, styles, prompt text are from the rendered page. None are executed server-side. Parser treats markup as strings; styles as strings.

3. **Socket path from env**: Herdr socket location comes from `HERDR_SOCKET_PATH` environment variable set by herdr when running inside it. Dev server is typically inside a herdr pane and inherits the var. Outside herdr: defaults to user's home, fallback clipboard.

4. **Attachment storage**: Temporary files for oversized snippets go to `os.tmpdir()/vite-plugin-herdr/`. Cleanup: attachments older than 24 hours deleted on startup. No secrets in attachments (user prompts are in the request body).

## Edge Cases

- **iframe picked as element**: Accepted, treated as target element.
- **Shadow DOM**: Open roots traversed; closed roots stop at host.
- **SVG**: Hit inside `<svg>` bubbles up to `<svg>` tag, not the tag inside it.
- **Base path != /**: Vite handles script injection; server-side routes mount under `server.config.base`.
- **Cross-origin images in snippet**: Not requested by server (no fetch); only copied from the page's own render cache.

No CSRF tokens needed: socket address is private to herdr pane env. Picker state is local to the page (no persistent session).
