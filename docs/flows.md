# Flows

## Pick flow

1. User presses the hotkey (default `ctrl+b`); the client arms picking mode. This works even while focus is inside an `<input>` or a `contenteditable`, the listener is registered in the capture phase with `preventDefault`.
2. On pointer move, the client resolves the deepest element under the cursor (`deepElementFromPoint`, crossing open shadow roots, stopping at closed ones) and draws a fixed-position outline over it, kept in sync on scroll and resize.
3. If the hit lands inside an `<svg>`, the client walks up to the `<svg>` element itself rather than the inner shape.
4. The plugin's own shadow-DOM host is excluded from hit-testing, you can never pick the picker.
5. On click, the client freezes the current target, resolves `sourceHint`, `selectorPath`, a trimmed HTML snippet with the picked node marked `data-herdr-picked`, a computed-style summary, and the bounding rect.
6. The popup opens: a textarea (autofocus), and the agent list fetched from `GET {endpoint}/state`, grouped by workspace, agents sorted by workspace `number`. The list starts collapsed behind a To field showing the preselected target (name, status, branch, pane); `Down` (or a click on the To field) expands it.

## Multi-select flow

1. While picking, `Shift+click` adds the hit-tested element to `selection` instead of finalizing the pick; each addition draws a persistent numbered outline box (badge `1`, `2`, ...), independent of the ephemeral hover outline, repositioned on scroll/resize alongside it.
2. The selection caps at 5 elements total (the primary plus 4 extras, `MAX_SELECTION`); a `Shift+click` past the cap shows an "Up to 5 elements" toast instead of adding one.
3. A plain click always finalizes the pick: with a selection already open, the click's own target is appended as the last element (when there's room); with an empty selection, the click is a normal single pick. The popup header shows "`N` elements" once more than one is selected.
4. `describeElement` runs on every selected element; the first becomes `element` in the request, the rest become `extras` (`ElementInfo[]`, up to 4).
5. `composePrompt`/`renderAttachment` render each extra as a numbered block, inline `Element N:` or, in the attachment variant, `## Element N`, rewriting that extra's own picked marker from `data-herdr-picked=""` to `data-herdr-picked="N"` (numbering starts at 2; the primary element keeps the empty marker). The "Page markup..." lead line's wording changes to mention numbered markers whenever extras are present.
6. Server-side, `validatePrompt` accepts up to 4 `extras` in `src/http.ts` (any single invalid item rejects the whole request, same policy as `element`), and `postPrompt` absolutizes every extra's hint the same way as the primary element's.
7. `Esc` while picking clears the whole selection (as well as disarming the picker).

## Send flow

7. User types a prompt (max 20000 characters), optionally opens the agent list with `Down` (collapsed by default) and changes the selection with `Up`/`Down` (the To field mirrors every move), and presses `Enter` or clicks `Send` (`Shift+Enter` inserts a newline instead). Only one send is in flight at a time.
8. Client-side prompt composition is skipped when herdr is reachable, composition happens server-side instead so relative source hints can be resolved against `server.config.root`; the client sends `{ target, prompt, element, extras?, screenshot? }` as JSON to `POST {endpoint}/prompt` (`extras` and `screenshot` only when a multi-selection or the screenshot switch is in play, see the flows below). When the selected target is a spawn row instead of an agent, the spawn flow below runs first and its resulting pane id becomes `target`.
9. The dev server validates same-origin (rejects 403), then JSON content-type, body size (256 KB cap, rejects 413), and shape via `validatePrompt` (rejects 400). Server resolves a relative `hint` to an absolute path via `absolutizeHint`, and composes the final prompt with `composePrompt`. Snippet/style payloads over `inlineMaxChars` (default 1500) are written to a markdown file first and referenced with a `Details: <path>` line.
10. The server opens one connection to herdr's Unix socket, sends `agent.prompt {target, text}`, and closes it.
11. herdr delivers the text to the chosen pane as bracketed paste plus `Enter`; a working agent (e.g. Claude Code) queues it as its next turn.
12. The server relays herdr's result back as `{ ok, target, title, pane_id, screenshot }`; the client shows a toast and closes the popup. HMR shows the agent's fix in the page once it lands.

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

## Screenshot flow

1. The `Attach screenshot` switch is only shown when live state reports `screenshot: 'available'` (the `screenshot` plugin option, `'auto'` by default meaning macOS only); its checked state persists in `localStorage['herdr:shot']`. Capture is skipped if the tab is hidden (`document.visibilityState !== 'visible'`).
2. If checked at send time, the client hides the popup, makes sure the hover outline and chip are drawn on the picked element (drawing them if they weren't already), and waits two animation frames for that repaint to land on screen before reading `window.screenX`/`screenY`, the browser chrome's top offset (`chromeTop` from outer vs. inner window height), `chromeLeft` (0 on macOS, where Chrome has no side borders and a side panel is right-aligned), `devicePixelRatio`, and the picked element's live bounding rect into the request body. The in-flight box/chip that appear next stay hidden for this same window, so the client's own overlay never lands inside the captured crop; they're revealed once the request settles.
3. The dev server turns that into a screen region (`screenRegion`): element rect plus window position plus chrome offsets, minus a 40px margin on every side, rounded and clamped to `[16, 4000]` on width/height and `>= 0` on x/y.
4. The server shells out to `screencapture -x -R <x>,<y>,<w>,<h> <file>` (silent capture, no camera sound) into the temp attachment directory (`screenshotCommand`, overridable for tests), then checks the file exists and is non-empty.
5. On success, `composePrompt` appends a `Screenshot: <path> (real pixels, the picked element is outlined, 40px margin)` line right before `---`, after the extras/styles lines (or after `Details:` in the attachment variant). The screenshot file itself is never referenced from the attachment markdown.
6. On failure (missing Screen Recording permission, command error, empty file), the error is caught and logged with `console.warn`, and the prompt still goes out without the `Screenshot:` line - never as an HTTP error, and never blocking the send.
7. `.png` files in the temp attachment directory expire the same way `.md` attachments do: `cleanupAttachments` deletes anything older than 24 hours, run once at server startup.

## Status watch flow

After the send returns (step 12 above), the server opens a new persistent connection and subscribes to `pane.agent_status_changed` events for the prompted pane via `events.subscribe`. The subscription pushes event lines while the agent works (e.g. `status: working`, then `status: idle` or `done`), and the server forwards these to the client over the HMR websocket as `herdr:status` messages (falling back to polling `/state` when HMR is unavailable). The client drives the in-flight outline from these: a `working` update keeps it, `idle`/`done` turns it solid green with a "✓ DONE" chip on the element for three seconds, then clears it with a "✓ DONE" toast, and `blocked` turns it red with a toast asking the user to go answer the agent in herdr. The watch itself closes automatically when the agent enters a settled status (idle, done, or blocked) or after 30 minutes.

## Spawn flow

The `+ agent here` and `+ agent in worktree` rows always sit at the end of the agent list (visible even while the list is collapsed). Selecting one (click, or `Down` past the last agent) just sets it as the To target, the same as selecting any agent; nothing is spawned yet. The spawn itself happens as the first step of a send, triggered by `Enter` or `Send` with a spawn row selected, or by calling the `POST {endpoint}/spawn` endpoint directly:

1. The popup enters its `sending` state (form dimmed, `Send` reads "Sending…", a second `Enter` is a no-op) before the client sends `{ mode: 'here' | 'worktree', name?, branch? }` as JSON to the spawn endpoint.
2. **Mode "here"** requires `HERDR_PANE_ID` set on the dev server process. The server calls `pane.split {direction: 'right', target_pane_id: HERDR_PANE_ID, cwd: root}` to create a sibling pane, then `agent.start {name, kind: 'claude', pane_id: newPaneId}` to start a claude agent in that pane, with a 70-second timeout.
3. **Mode "worktree"** calls `worktree.create {workspace_id: HERDR_WORKSPACE_ID, branch?, focus: false}` to create a new workspace/pane pair, then `agent.start` in its root pane.
4. The server returns `{ ok: true, pane_id, name, workspace_id }` to the client. The client reloads the agent list (so `findTitle`/`findSession` can see the new pane) and continues the same send it already started: the new pane id becomes `target`, and the prompt goes out to it exactly like a send to any other agent, ending in one "Sent to ..." toast and a closed popup.
5. On failure (network error, or a non-200 response), an error toast shows the reason, the agent list still reloads, and the popup reopens with the draft prompt intact so the same or a different target can be retried - nothing was sent.

## Clipboard fallback

13. Before opening the popup, the client already has the result of `GET {endpoint}/state`. If the response is `{ herdr: false, reason, message }` (no socket reachable, or protocol below 20), a notice takes the To field's place (`herdr not reachable (<reason>): Enter copies the prompt`) and the agent list underneath renders no groups and no spawn rows.
14. On `Enter`, the client composes the prompt itself instead of asking the server (the source hint stays relative, since the Vite root isn't known client-side) and writes it to the clipboard via the Clipboard API.
15. A toast confirms the copy and names the reason herdr wasn't used, so the user knows to paste it into their agent by hand.

## Error cases

16. **Blocked agent.** `POST /prompt` against a `blocked` agent returns `409 agent_blocked`. The client shows a toast, leaves the popup open with the same draft, and the agent stays visually marked non-selectable so the same mistake isn't repeated.
17. **Agent gone.** The target pane no longer exists in herdr's session (closed, pane killed) by the time the request lands: `404 not_found`. Toast shown, popup stays open with a stale-list notice; the client can refetch `/state`.
18. **herdr unreachable.** The socket is missing or refuses the connection: `502`. This is the same condition as "no herdr" for the state endpoint, `GET /state` already reported `{ herdr: false }` and the client was in clipboard mode from the start, so this path is mostly a race (herdr died between the state fetch and the send) rather than the common case.
19. **Protocol too old.** `session.snapshot` reports a `protocol` below 20: the server treats this exactly like herdr being absent and returns `{ herdr: false, reason: 'protocol', message }`, no attempt is made to speak an older dialect.

## Benchmark flow

20. `bench/tasks.json` defines 10 tasks against the demo's Bench view: 5 textual (label, link, aria-label, color token, typo), 5 visual (misaligned card, spacing, overflow, font-size, hover state).
21. `bench/capture.ts` drives Playwright Chromium against the running demo dev server: for each task it locates the element, calls `window.__herdr.describe(el)` for the `ElementInfo`, draws the outline via `window.__herdr.outline(el)` for the outline variant, and takes a real-pixel `page.screenshot({ clip })`.
22. `bench/run.ts` copies the demo into a fresh temp directory per run (git-initialized, one commit), writes a one-paragraph `CLAUDE.md` there so the run is headless and self-contained, composes the prompt for the task's variant, and runs `claude -p` non-interactively with a fixed tool allowlist and turn cap.
23. Results (`num_turns`, `duration_ms`, `total_cost_usd`, `is_error`, whether the expected file changed, whether an expected substring appears, and for visual tasks a judge score) are appended one line per run to `<out>/runs.jsonl`; at the end `bench/run.ts` writes `summary.json` and `summary.md`.
24. The decision rule in [docs/payload.md](payload.md) is applied to the aggregated numbers, and the outcome is written back into that file's Results section and linked from the README.
