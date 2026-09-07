# Stack

## Decision

| Component | Choice | Role |
|---|---|---|
| Delivery | **Vite plugin** | Injects the picker, serves the client, bridges to herdr; `apply: 'serve'` |
| Language | **TypeScript, strict** | Whole codebase, matching `vue-viewports` conventions |
| Unit tests | **Vitest** | Pure functions (`compose.ts`, `dom.ts`, `agents.ts`), node + jsdom environments in one config |
| End-to-end | **Playwright** | Real dev server, real herdr fake on a temp socket, real browser interaction |
| Client UI | **Vanilla DOM in a shadow DOM host** | No framework: the plugin must inject into any Vite app regardless of what that app uses |
| Socket transport | **Node stdlib `net`** | One connection per request to herdr's Unix socket, no client library exists or is needed |
| CI/CD | **GitHub Actions** | Lint, typecheck, coverage, build, demo build, Playwright e2e; release on tag |

## Why a Vite plugin

Versus a Chrome extension:

- **One piece instead of three.** An extension needs a native messaging host and a background bridge process too; the plugin is the bridge.
- **No new port.** The dev server already listens; adding a fixed localhost port is a second thing to configure, firewall, and secure.
- **The dev server already knows its workspace.** Running inside a herdr pane, it inherits `HERDR_WORKSPACE_ID` and `HERDR_PANE_ID` for free, an extension would have to ask.
- **Source hints for free.** Dev-mode locator plugins (vite-plugin-vue-inspector, code-inspector-plugin, agent-source-locator) already inject `file:line:col` attributes into the DOM Vite serves; an extension sees only the rendered page, with no compile-time information.

The extension stays the right answer for pages you don't serve yourself: production sites, third-party apps, anything not running through your own Vite dev server. That's parked, not rejected, see [Roadmap](../README.md#roadmap).

## Evaluated alternatives (2026-09-07)

| Tool | What it does | Reaches the agent how | Verdict |
|---|---|---|---|
| [stagewise](https://github.com/stagewise-io/stagewise) (AGPLv3, ~6.8k stars) | Browser toolbar, click element + comment; now an Electron "agentic IDE" | MCP bridge; bridge mode looks for other local agents | One target; its own docs warned multi-window setups risk sending the prompt to the wrong window. No session picker |
| Cursor Design Mode (2026-06-05) | Click/draw/voice in the in-editor browser; context = element identity + computed styles + screenshot | Built-in only | Closed inside Cursor, single agent |
| GitHub Copilot browser tools (VS Code 1.132, GA 2026-07-01) | Element-level feedback, multi-select with one comment | Built-in only | Closed inside VS Code, single agent |
| Windsurf Browser Preview "Send element" | @-mentions the element | Built-in Cascade | Closed, single agent |
| MCP Pointer, PinPoint | Option+click captures element + CSS + selector | Fixed localhost port (`:7007`, `:5050`); PinPoint documents "no authentication by design" | One fixed endpoint, open port reachable by any page on the machine |
| claude-code-inspector, claude-bridge-chrome-extension, drawbridge | Chrome extensions sending element context to Claude Code | Fixed localhost ports | Single target; clipboard fallback validates our own v0 approach |
| agent-source-locator | Vite/webpack plugin injecting `data-asl`, POSTs the location to the dev server, which types it into the attached agent | Dev server | Closest architecture to ours; no session list, no herdr integration |
| LocatorJS, click-to-component, react-dev-inspector | Click element, open source in the editor | Editor deep link | No agent, no prompt, different problem |
| Claude in Chrome, OpenAI Codex Chrome extension, Chrome DevTools MCP | The agent drives the browser | n/a | Opposite direction: agent-controls-browser, not browser-feeds-agent |

None of them lists the agent sessions already running and lets you pick one. That gap is the product.

## Transport and security

Why not a plain localhost server: any page open in the browser, including a malicious tab, can reach `http://localhost:<port>` unless something blocks it. Chrome's Local Network Access work (shipped Chrome 142, split into local-network and loopback-network permissions in 145, WebSocket covered from 147) gates access to public pages reaching *private* addresses, but a page served *from* localhost reaching another localhost port is unaffected, that's the exact hole MCP Pointer and PinPoint leave open.

The dev server sidesteps the question instead of trying to lock the port down: there is no new port. The browser talks to the same origin it's already served from, and the plugin's same-origin guard (`Sec-Fetch-Site: same-origin`, or `Origin` host matching `Host`) rejects everything else with `403`. The socket itself has no auth, by design of herdr's protocol, filesystem permissions on `$HERDR_SOCKET_PATH` are the boundary, and only the dev server process (not the browser) ever touches it.

## Community signal

Enumerating and messaging your own live agent sessions is a recognized pain, not a niche one: an r/ClaudeCode thread on cross-session messaging drew 1,487 upvotes and 326 comments, and the matching Hacker News post ("Message your other Claude Code sessions") reached 173 points, both in the 30 days to 2026-09-07. Every homemade bridge found in the same window (a Claude Code ↔ Codex bridge, MulmoTerminal, HarnessRouter, Codenotch) is single-target on a fixed local port, "which session, in what state" is still solved by hand in all of them. The market's energy is mostly pointed the other way, agent-drives-browser (Claude in Chrome, Browsercode, Wolfpack); browser-feeds-agent is a small, mostly empty space, and herdr is the only tool in it that can enumerate interactive terminal sessions at all.
