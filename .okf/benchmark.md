---
type: Experiment
title: Payload variant comparison
description: Measure if images (screenshot, outline) improve agent task success; decide scope for v1
tags: [benchmark, image-payload, screenshot, outline, cost]
generated:
  by: claude/fable-5
  at: 2026-09-07
status: draft
---

## Study Design

**Objective**: Decide if real screenshots improve agent success on visual tasks without hurting text-only tasks.

**Setup**: 10 tasks on demo's "Bench" view — 5 text changes (label, link, aria-label, color token, typo), 5 visual (card misaligned, spacing, overflow, font-size, hover state). Each task: selector, prompt, expected file and optional expected diff substring.

**Variants**:
- `text`: Prompt with element + styles only.
- `text+shot`: Prompt + screenshot (Playwright Chromium, real pixels, clipped with margin, no outline).
- `text+shot+outline`: Same screenshot, outline rectangle drawn by picker.

**Repetitions**: 3 (may reduce to 2 if cost prohibitive).

**Execution** (`bench/run.ts`): Playwright captures Chromium, `window.__herdr.describe()` extracts ElementInfo, draws outline if needed, `page.screenshot({clip})` saves pixels. Prompt composed with `composePrompt()` + `Screenshot: <path>` line. Headless Claude invoked via CLI (`claude -p "<prompt>"` with limited tools: Read, Edit, Write, Grep, Glob), max 30 turns. Measures num_turns, duration, cost, is_error; verifies `git diff` against expectation.

**Cost estimate**: ~90 runs × $0.15-0.40 each ≈ $15-40. Must confirm before launch.

## Decision Rule

Image enters v2 if:
- Visual tasks: success +≥15 points or turns -≥25%, AND
- Text tasks: no regression.

Otherwise: no screenshot in product; decision documented in README with data.

Outline: if outline+shot beats shot naked on visual tasks, keep it in v2.

## Deliverable

`bench/results/<date>.json`: raw data (tasks, variants, runs, success, turns, cost).
Markdown table: variant, success rate, avg turns, avg cost, first-try pass rate.
Log entry to `.okf/log.md` with decision + numbers.
