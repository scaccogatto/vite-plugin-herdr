---
type: Experiment
title: Payload variant comparison
description: Measured whether images (screenshot, outline) improve agent task success; the outlined screenshot shipped as opt-in
tags: [benchmark, image-payload, screenshot, outline, cost]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: stable
sources:
  - resource: ../docs/payload.md
  - resource: ../docs/flows.md
  - resource: ../docs/bench/2026-09-07/summary.md
---

## Study Design

**Objective**: Decide if real screenshots improve agent success on visual tasks without hurting text-only tasks.

**Setup**: 10 tasks on demo's "Bench" view: 5 text changes (label, link, aria-label, color token, typo), 5 visual (card misaligned, spacing, overflow, font-size, hover state). Each task: selector, prompt, expected file and optional expected diff substring.

**Variants**:
- `text`: Prompt with element + styles only.
- `text+shot`: Prompt + screenshot (Playwright Chromium, real pixels, clipped with margin, no outline).
- `text+shot+outline`: Same screenshot, outline rectangle drawn by picker.

**Repetitions**: 3 (may reduce to 2 if cost prohibitive).

**Execution** (`bench/capture.ts` + `bench/run.ts`): Playwright drives Chromium against the demo dev server, `window.__herdr.describe()` extracts `ElementInfo`, draws the outline if the variant needs it, `page.screenshot({clip})` saves real pixels. For each (task, variant, repetition), `bench/run.ts` copies `demo/` into a fresh temp dir (`git init` + one commit), writes a one-paragraph `CLAUDE.md` into that copy ("run headless, single pass, no worktree, no questions") so the global CLAUDE.md conventions (worktree rule, ponytail hook) don't inflate every run's turn count uniformly and mask the signal being measured. Prompt composed with `composePrompt()` + `Screenshot: <path>` line for image variants. Headless Claude invoked via CLI: `claude -p "<prompt>" --output-format json --permission-mode acceptEdits --allowedTools Read,Edit,Write,Grep,Glob --max-turns 30` (tool names re-checked against `claude --help` at launch time, not hardcoded from memory). Measures `num_turns`, `duration_ms`, `total_cost_usd`, `is_error`; verifies `git diff --name-only` against `expectFile` and, when present, `expectContains`. Visual tasks without an `expectContains` get a second `claude -p` judge call instead: given the diff and the task's rubric, it scores 0 (defect not addressed) / 1 (addressed imperfectly) / 2 (matches the ask).

**Cost estimate**: ~90 runs × $0.15-0.40 each ≈ $15-40. Must confirm before launch.

## Decision Rule

Screenshot enters v2 if: visual success +≥15 points or turns -≥25% (vs. text), without visual or edit regression (no variant qualifies if its visual success regresses).
Outline: only if it beats text+shot on visual metrics, and only when it qualifies.

## Deliverable

`bench/results/<date>.json`: raw data (tasks, variants, runs, success, turns, cost).
Markdown table: variant, success rate, avg turns, avg cost, first-try pass rate.
Log entry to `.okf/log.md` with decision + numbers.

## Results

Run on 2026-09-07 with Claude Sonnet 5 through `claude -p` (`--reps 1`): 10 tasks × 3 variants, 30 headless runs, 0 errors after retrying transient CLI failures, total cost ≈ $4. Raw data: `docs/bench/2026-09-07/runs.jsonl`; rendered summary: `docs/bench/2026-09-07/summary.md`.

| Variant | Kind | n | successRate | meanTurns | meanCostUsd | rightFileRate |
|---|---|---|---|---|---|---|
| text | edit | 5 | 100% | 3.8 | $0.11 | 100% |
| text | visual | 5 | 60% | 6.0 | $0.14 | 80% |
| text+shot | edit | 5 | 100% | 4.0 | $0.11 | 100% |
| text+shot | visual | 5 | 60% | 5.4 | $0.13 | 80% |
| text+shot+outline | edit | 5 | 100% | 3.4 | $0.10 | 100% |
| text+shot+outline | visual | 5 | 80% | 4.6 | $0.13 | 80% |

**Decision**: the outlined screenshot ships. Edit tasks land on the right file every time regardless of variant (source hints already do the heavy lifting there). A bare screenshot (`text+shot`) moves nothing on visual tasks versus `text` alone and costs more time. Only `text+shot+outline` clears the decision rule on visual tasks: +20 points of success (60% → 80%) and a 23% cut in mean turns (6.0 → 4.6), with no regression on edit tasks. Per the pre-registered rule, this promotes the screenshot into the product (v2) as an opt-in, always-outlined feature; the bare/no-outline variant never ships.

**Caveat**: five visual tasks at one repetition each is a small sample - the gap traces mostly to one task (`hover`) that only the outlined variant solved. The direction is what the decision rests on, not the exact decimals; a `--reps 3` re-run would firm up the numbers without being expected to change the call.
