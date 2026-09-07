# Benchmark Tasks

This folder holds the benchmark suite for measuring agent success on UI defect detection and repair.

## tasks.json Format

`tasks.json` contains an array of benchmark task objects. Each task has:

- `id`: Unique identifier for the task (used in results).
- `kind`: Either `"edit"` (text/code changes) or `"visual"` (appearance/styling fixes).
- `selector`: CSS selector for the DOM element to target.
- `prompt`: Natural language prompt a developer would send to an agent for repair.
- `expectFile`: The source file being modified (usually `Bench.vue`).
- `expectContains`: For edit tasks, a substring expected in the fixed code; `null` for visual tasks.
- `rubric`: For visual tasks, a one-sentence description of what a correct fix looks like.

## Execution

Capture and run scripts (not yet included) will:
1. Serve the demo app with `npm run dev-demo`.
2. For each task, capture the element and surrounding context.
3. Send a prompt to an agent via CLI (e.g., `claude -p "<prompt>"`).
4. Verify the fix by checking code changes or visual inspection (depending on task kind).
5. Record metrics: number of turns, duration, cost, success/failure.

## Results

Test results are saved to `bench/results/` as JSON files keyed by date and variant (text, text+shot, text+shot+outline).
