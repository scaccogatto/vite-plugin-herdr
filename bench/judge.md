You are grading a code change made by a coding agent in a small Vue demo app used for benchmarking.

Task given to the agent:
{{task}}

Rubric for a correct fix:
{{rubric}}

Unified diff of the change the agent made:

```diff
{{diff}}
```

Grade the diff against the rubric:

- 2: the diff clearly implements the rubric, with no unrelated or collateral changes.
- 1: the diff partially implements the rubric, or implements it but also makes unrelated changes.
- 0: the diff does not address the rubric.

Answer with a single JSON object only, no other text before or after it:

{"score": 0 | 1 | 2, "reason": "<one sentence>"}
