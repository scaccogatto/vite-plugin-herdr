# Payload benchmark

Measures whether attaching a real screenshot (and, further, a screenshot with the picker's
outline drawn on it) to the prompt helps a coding agent fix UI defects, versus text alone. The
pre-registered protocol and the decision rule live in [`docs/payload.md`](../docs/payload.md);
this folder is the harness that produces the numbers it's read off.

## Prerequisites

- `npx playwright install chromium` (this repo's Playwright config only needs Chromium)
- `claude` CLI installed and logged in (`claude -p` must work headless)

## Running it

Pick a run id, conventionally `bench/results/<YYYYMMDD-HHMM>`:

```sh
node bench/capture.ts --out bench/results/20260907-1200
node bench/run.ts --out bench/results/20260907-1200
```

`capture.ts` starts the demo dev server, drives headless Chromium through the ten tasks in
`bench/tasks.json`, and writes `captures.json` plus a `<taskId>-shot.png` /
`<taskId>-shot-outline.png` pair per task into the run directory.

`run.ts` then runs, for every (task, variant, repetition), a headless `claude -p` session against
a fresh temp copy of `demo/`, checks the result, and appends one line to `runs.jsonl`. At the end
it writes `summary.json` and `summary.md` and prints the markdown table.

### Options

```
node bench/run.ts --out <dir> [--variants text,text+shot,text+shot+outline] [--reps 1]
  [--tasks label,link] [--model sonnet] [--max-turns 30] [--dry-run] [--report-only]
```

- `--variants` / `--tasks`: comma-separated subsets, useful for a smoke run before committing to
  the full 90-run sweep.
- `--dry-run`: builds and prints the composed prompt for the first repetition of each task/variant
  without spawning `claude` or touching `runs.jsonl` - use this to sanity-check the prompt.
- `--report-only`: skips execution and just re-summarizes whatever is already in `runs.jsonl`.

## Resumability

`run.ts` skips any (task, variant, rep) combination already present in `<out>/runs.jsonl`. A
killed or interrupted run resumes cleanly by re-running the same command.

## Cost

Each (task, variant, rep) is one headless Claude session (two for visual tasks, since a second
`claude -p` call acts as judge). At an estimated $0.15-$0.40 per session, the full 10-task x
3-variant x 3-rep sweep (90 runs) costs roughly $15-$40; run `--reps 1` first to confirm the
estimate before committing to the full sweep.

## The decision

The screenshot/outline decision rule is pre-registered in `docs/payload.md` and is not re-derived
here. Once a run's `summary.md` looks final, paste it into that file's Results section - that's
the artifact the decision is read off.
