---
type: Architecture
title: vite-plugin-herdr module design
description: Eight source modules split between server and client, sharing pure types and composition functions
tags: [plugin, vite, client-server, modules]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
sources:
  - resource: ../docs/stack.md
  - resource: ../README.md
---

## System Decomposition

Eight modules organize the plugin: four on Node (server), three on DOM (client), one pure layer shared between them. `compose.ts` is the shared layer specifically because it must have no Node and no DOM imports, it runs both in the server (composing the final prompt) and, unbuilt, in clipboard-fallback code paths.

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin factory: options + defaults, `apply: 'serve'`, `transformIndexHtml` (injects the client `<script type=module>` tag), `resolveId` for the virtual client module, `configureServer` mounting the two routes, attachment write/cleanup |
| `src/herdr.ts` | Socket client: `resolveSocketPath`, `request(socketPath, method, params, timeoutMs)` (one connection per request), `parseLine`, `HerdrError { code }`, `httpStatus(code)` |
| `src/http.ts` | `isSameOrigin(headers)`, `readJson(req, maxBytes)`, `validatePrompt(body)`, `sendJson` |
| `src/types.ts` | `ElementInfo`, `AgentRow`, `WorkspaceRow`, `StateResponse`, `PromptRequest`, and the rest of the shared contracts |
| `src/compose.ts` | Pure, shared: `renderAttachment(el)`, `composePrompt(el, prompt, { attachmentPath? })` |
| `src/client/index.ts` | UI: shadow-DOM host, hotkey, pick mode with outline, click interception, popup, send/copy, toast; exposes `window.__herdr = { describe, outline }` for the bench and for debugging |
| `src/client/dom.ts` | Pure DOM utilities: `parseHotkey`, `matchesHotkey`, `deepElementFromPoint`, `sourceHint`, `selectorPath`, `trimHtml`, `styleSummary`, `describeElement` |
| `src/client/agents.ts` | Pure: `groupAgents(state)`, `pickAgent(state, last)` |

## Build Strategy

One `vite.config.ts` with two modes:

- **Node build** (`mode` unset): Entry `src/index.ts`, external `/^node:/` and `vite`, `vite-plugin-dts` bundles types, target `node20`.
- **Client build** (`mode === 'client'`): Entry `src/client/index.ts`, `fileName: 'client.js'`, `emptyOutDir: false`, target `es2022`, no minify.

Run both: `vite build && vite build --mode client`.

Virtual module resolution: `resolveId('virtual:vite-plugin-herdr/client')` points Vite to the real client file. When `import.meta.url` ends in `.ts`, Vite serves sources (demo, tests); in `.js`, it serves the built `dist/client.js` (published package).

## Contracts

Plugin options:

```typescript
interface Options {
  hotkey?: string                  // ctrl+b
  socketPath?: string              // $HERDR_SOCKET_PATH, fallback ~/.config/herdr/herdr.sock
  enabled?: boolean                // true
  endpoint?: string                // /__herdr
  snippet?: { maxDepth?, maxLines?, inlineMaxChars? }  // 3, 60, 1500
}
```

Server endpoints:

| Route | Method | Request | Response |
|-------|--------|---------|----------|
| `{base}/__herdr/state` | GET | none | 200: `StateResponse`; 403: cross-origin; 502: socket missing |
| `{base}/__herdr/prompt` | POST | JSON max 256KB | 200: `PromptResponse`; 400/409/413: error; 502/503: server errors |

Client does not read `import.meta.env`; it parses hotkey and endpoint from query string injected at `transformIndexHtml`.
