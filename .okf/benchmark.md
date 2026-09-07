---
type: Experiment
title: Payload variant comparison
description: Measure if images (screenshot, outline) improve agent task success; decide scope for v1
tags: [benchmark, image-payload, screenshot, outline, cost]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
sources:
  - resource: ../docs/payload.md
  - resource: ../docs/flows.md
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
