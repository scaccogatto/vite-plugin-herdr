---
okf_version: '0.2'
---

# vite-plugin-herdr - DOM picker to herdr agents

Pick a DOM element in your browser and send it, with a prompt, to a coding agent running in herdr. Bridge from the browser through the Vite dev server to herdr's socket protocol.

A plugin reduces context switching during development: instead of copying selectors, code, and screenshots across tools, use `ctrl+b` to pick an element and send a prompt directly to the agent workspace.

The narrative documentation these concepts distill lives one level up, in the repo's `README.md`, `PRODUCT.md`, and `docs/` (`stack.md`, `flows.md`, `payload.md`); each concept's `sources` field points back to the specific files it draws from.

## Concepts

* [Architecture](architecture.md) - System design and module responsibilities
* [Payload](payload.md) - What the agent receives: element capture, prompt format, image decision
* [Herdr Protocol](herdr-protocol.md) - Facts on herdr 0.8.2 and the bridge implementation
* [Security](security.md) - Same-origin guardrails and data handling
* [Benchmark](benchmark.md) - Measuring if images improve agent success
* [Release](release.md) - Versioning and publication runbook
