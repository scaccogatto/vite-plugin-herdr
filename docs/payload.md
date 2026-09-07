# Payload

## The reasoning

The agent has to do three things: find the code, understand the change, verify it. Text covers the first two almost always; an image only earns its place for bugs that are visual by nature.

**Text first.** The source hint wins on "find": a locator-plugin attribute gives `file:line:col` directly, a runtime fallback gives at least the file, and if neither is present the agent falls back to the selector path, classes, and text, then greps. "Understand" is covered by a trimmed HTML snippet with the picked node marked (`data-herdr-picked`), its ancestor chain, a 15-property computed-style summary, the bounding box, and the viewport. All of it is deterministic, small, and greppable, nothing here is a rendering the agent has to interpret visually.

**Why fake screenshots mislead.** A re-render of the DOM onto a canvas (the `html2canvas` approach) gets fonts wrong, breaks on cross-origin images, and can't see into shadow DOM. That's very likely the actual content of every "doesn't always work well" complaint about DOM-to-image tools: it looks like a screenshot, so the agent (and the user) trust it like one, and it quietly lies. vite-plugin-herdr never generates one.

**Real pixels only.** If a screenshot is going to exist at all, it's a real one: Playwright's `page.screenshot()` in the benchmark, `screencapture -R` on macOS in the product (fired by the dev server, with the picker's outline still drawn, cropped with a margin). Nothing in between.

**Three highlight layers**, each doing a different job:

1. In the snippet: the `data-herdr-picked` marker on the node itself, plus the `Focus:` line in the prompt.
2. In the (opt-in, benchmark-gated) screenshot: the picker's outline drawn inside the crop.
3. On the live page: the outline stays on the element until herdr reports the agent idle or done (v2, not yet built).

The benchmark below measures both questions separately: text vs. text+screenshot, and screenshot-with-outline vs. screenshot-without.

## Benchmark protocol (pre-registered)

This protocol is fixed before any run happens, so the decision is read off the numbers, not fit to them afterward.

**Tasks.** 10 tasks against the demo's `Bench` view: 5 textual (label copy, link target, `aria-label`, a color token, a typo) and 5 visual (a misaligned card, wrong spacing, an overflow, a wrong font-size, a missing hover state). Each task in `bench/tasks.json` carries `selector`, `prompt`, `expectFile`, an optional `expectContains`, and `kind` (`text` | `visual`).

**Variants.**

| Variant | Payload |
|---|---|
| `text` | The v0/v1 prompt: element info, no image |
| `text+shot` | `text` + a real-pixel screenshot, clipped to the element with a margin, no outline |
| `text+shot+outline` | Same crop, with the picker's outline drawn on it |

**Repetitions.** 3 per task per variant (90 runs total; may drop to 2 if cost runs high, noted at launch time either way).

**Execution.** `bench/capture.ts` drives Playwright Chromium against the demo's dev server: for each task, `window.__herdr.describe(el)` produces the `ElementInfo`, `window.__herdr.outline(el)` draws the outline when the variant needs it, and `page.screenshot({ clip })` captures real pixels. `bench/run.ts` then, for every (task, variant, repetition):

1. Copies `demo/` into a fresh temp directory, `git init` and an initial commit.
2. Writes a one-paragraph `CLAUDE.md` into that copy: run headless, single pass, edit in place, no worktree, no questions. This keeps the global CLAUDE.md conventions (the worktree rule, the ponytail hook) from inflating every run's turn count uniformly and burying the signal the benchmark is trying to measure.
3. Composes the prompt with `composePrompt`, adding a `Screenshot: <path>` line for the image variants.
4. Runs headless: `claude -p "<prompt>" --output-format json --permission-mode acceptEdits --allowedTools Read,Edit,Write,Grep,Glob --max-turns 30`. Tool names are re-checked against `claude --help` at launch time rather than hardcoded from memory, the CLI's allowlist surface has moved before.
5. Reads `num_turns`, `duration_ms`, `total_cost_usd`, `is_error` from the JSON result.
6. Checks `git diff --name-only` against `expectFile`, and `expectContains` when the task has one.
7. For visual tasks without an `expectContains` (most of them: the change is a visual one, not a string), a second `claude -p` call acts as judge: it's given the diff and the task's rubric, and scores 0/1/2 (0 = didn't address the visual defect, 1 = addressed it but imperfectly, 2 = matches the ask).

**Isolation.** `bench/` has its own `package.json` and lockfile for Playwright (Chromium only). The published library never pulls in a browser download; the benchmark stays runnable on its own.

**Metrics reported per variant:** success rate, average turns, average duration, average cost, first-try-correct-file rate.

**Decision rule.**

- The screenshot enters the product (v2, opt-in) only if it raises visual success by at least 15 points **or** cuts visual turns by at least 25% (vs. text), **without regression in visual or edit success**. A screenshot variant that regresses visual success is rejected, even if it cuts turns.
- Otherwise: no screenshot ships. This file's Results section, and the README, say so with the numbers.
- The outline stays in the product's image path only if `text+shot+outline` beats `text+shot` on visual success or visual turns, and only when the outline variant itself qualifies; if not, the outline doesn't ship even if `text+shot` does.

**Cost note.** 90 headless runs at an estimated $0.15–$0.40 each puts the full run at roughly $15–$40. This is confirmed before the benchmark launches, not assumed; repetitions drop from 3 to 2 first if the estimate needs trimming.

## Results

Pending: filled in when the benchmark runs.
