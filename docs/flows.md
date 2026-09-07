# Flows

## Pick flow

1. User presses the hotkey (default `ctrl+b`); the client arms picking mode. This works even while focus is inside an `<input>` or a `contenteditable`, the listener is registered in the capture phase with `preventDefault`.
2. On pointer move, the client resolves the deepest element under the cursor (`deepElementFromPoint`, crossing open shadow roots, stopping at closed ones) and draws a fixed-position outline over it, kept in sync on scroll and resize.
3. If the hit lands inside an `<svg>`, the client walks up to the `<svg>` element itself rather than the inner shape.
4. The plugin's own shadow-DOM host is excluded from hit-testing, you can never pick the picker.
5. On click, the client freezes the current target, resolves `sourceHint`, `selectorPath`, a trimmed HTML snippet with the picked node marked `data-herdr-picked`, a computed-style summary, and the bounding rect.
6. The popup opens: a textarea (autofocus), and the agent list fetched from `GET {endpoint}/state`, grouped by workspace, agents sorted by workspace `number`.

## Send flow

7. User types a prompt (max 20000 characters), optionally changes the selected agent with `Up`/`Down`, and presses `Enter` (`Shift+Enter` inserts a newline instead). Only one send is in flight at a time.
8. Client-side prompt composition is skipped when herdr is reachable, composition happens server-side instead so relative source hints can be resolved against `server.config.root`; the client sends `{ target, prompt, element }` as JSON to `POST {endpoint}/prompt`.
9. The dev server validates same-origin (rejects 403), then JSON content-type, body size (256 KB cap, rejects 413), and shape via `validatePrompt` (rejects 400). Server resolves a relative `hint` to an absolute path via `absolutizeHint`, and composes the final prompt with `composePrompt`. Snippet/style payloads over `inlineMaxChars` (default 1500) are written to a markdown file first and referenced with a `Details: <path>` line.
10. The server opens one connection to herdr's Unix socket, sends `agent.prompt {target, text}`, and closes it.
11. herdr delivers the text to the chosen pane as bracketed paste plus `Enter`; a working agent (e.g. Claude Code) queues it as its next turn.
12. The server relays herdr's result back as `{ ok, target, title }`; the client shows a toast and closes the popup. HMR shows the agent's fix in the page once it lands.

### Send flow, sequence

```
Page/Client        Dev server           herdr socket        Agent pane
    │                    │                     │                  │
    │ POST /prompt       │                     │                  │
    │ {target,prompt,el} │                     │                  │
    │───────────────────▶│                     │                  │
    │                    │ resolve hint path   │                  │
    │                    │ compose prompt      │                  │
    │                    │ agent.prompt        │                  │
    │                    │────────────────────▶│                  │
    │                    │                     │ bracketed paste  │
    │                    │                     │ + Enter          │
    │                    │                     │─────────────────▶│
    │                    │  {agent_prompted}   │                  │
    │                    │◀────────────────────│                  │
    │  200 {ok,target}   │                     │                  │
    │◀───────────────────│                     │                  │
    │ toast, close popup │                     │                  │
```

## Status watch flow

After the send returns (step 12 above), the server opens a new persistent connection and subscribes to `pane.agent_status_changed` events for the prompted pane via `events.subscribe`. The subscription pushes event lines while the agent works (e.g. `status: working`, then `status: idle` or `done`), and the server forwards these to the client over the HMR websocket as `herdr:status` messages. The client does not currently act on these, but the watch closes automatically when the agent enters a settled status (idle, done, or blocked) or after 30 minutes.

## Spawn flow

When the user clicks "Spawn a new agent" in a future UI or calls the `POST {endpoint}/spawn` endpoint directly:

1. Client sends `{ mode: 'here' | 'worktree', name?, branch? }` as JSON to the spawn endpoint.
2. **Mode "here"** requires `HERDR_PANE_ID` set on the dev server process. The server calls `pane.split {direction: 'right', target_pane_id: HERDR_PANE_ID, cwd: root}` to create a sibling pane, then `agent.start {name, kind: 'claude', pane_id: newPaneId}` to start a claude agent in that pane, with a 70-second timeout.
3. **Mode "worktree"** calls `worktree.create {workspace_id: HERDR_WORKSPACE_ID, branch?, focus: false}` to create a new workspace/pane pair, then `agent.start` in its root pane.
4. The server returns `{ ok: true, pane_id, name, workspace_id }` to the client.

## Clipboard fallback

13. Before opening the popup, the client already has the result of `GET {endpoint}/state`. If the response is `{ herdr: false, reason, message }` (no socket reachable, or protocol below 20), the popup shows no agent list, only the textarea.
14. On `Enter`, the client composes the prompt itself instead of asking the server (the source hint stays relative, since the Vite root isn't known client-side) and writes it to the clipboard via the Clipboard API.
15. A toast confirms the copy and names the reason herdr wasn't used, so the user knows to paste it into their agent by hand.

## Error cases

16. **Blocked agent.** `POST /prompt` against a `blocked` agent returns `409 agent_blocked`. The client shows a toast, leaves the popup open with the same draft, and the agent stays visually marked non-selectable so the same mistake isn't repeated.
17. **Agent gone.** The target pane no longer exists in herdr's session (closed, pane killed) by the time the request lands: `404 not_found`. Toast shown, popup stays open with a stale-list notice; the client can refetch `/state`.
18. **herdr unreachable.** The socket is missing or refuses the connection: `502`. This is the same condition as "no herdr" for the state endpoint, `GET /state` already reported `{ herdr: false }` and the client was in clipboard mode from the start, so this path is mostly a race (herdr died between the state fetch and the send) rather than the common case.
19. **Protocol too old.** `session.snapshot` reports a `protocol` below 20: the server treats this exactly like herdr being absent and returns `{ herdr: false, reason: 'protocol_unsupported', message }`, no attempt is made to speak an older dialect.

## Benchmark flow

20. `bench/tasks.json` defines 10 tasks against the demo's Bench view: 5 textual (label, link, aria-label, color token, typo), 5 visual (misaligned card, spacing, overflow, font-size, hover state).
21. `bench/capture.ts` drives Playwright Chromium against the running demo dev server: for each task it locates the element, calls `window.__herdr.describe(el)` for the `ElementInfo`, draws the outline via `window.__herdr.outline(el)` for the outline variant, and takes a real-pixel `page.screenshot({ clip })`.
22. `bench/run.ts` copies the demo into a fresh temp directory per run (git-initialized, one commit), writes a one-paragraph `CLAUDE.md` there so the run is headless and self-contained, composes the prompt for the task's variant, and runs `claude -p` non-interactively with a fixed tool allowlist and turn cap.
23. Results (`num_turns`, `duration_ms`, `total_cost_usd`, `is_error`, whether the expected file changed, whether an expected substring appears, and for visual tasks a judge score) are written to `bench/results/<date>.json`.
24. The decision rule in [docs/payload.md](payload.md) is applied to the aggregated numbers, and the outcome is written back into that file's Results section and linked from the README.
