# Payload benchmark summary

| Variant | Kind | n | successRate | meanTurns | meanDurationMs | meanCostUsd | rightFileRate | errors |
|---|---|---|---|---|---|---|---|---|
| text | edit | 5 | 100% | 3.8 | 10412 | $0.11 | 100% | 0 |
| text | visual | 5 | 60% | 6.0 | 14573 | $0.14 | 80% | 0 |
| text+shot | edit | 5 | 100% | 4.0 | 8428 | $0.11 | 100% | 0 |
| text+shot | visual | 5 | 60% | 5.4 | 27820 | $0.13 | 80% | 0 |
| text+shot+outline | edit | 5 | 100% | 3.4 | 8121 | $0.10 | 100% | 0 |
| text+shot+outline | visual | 5 | 80% | 4.6 | 16984 | $0.13 | 80% | 0 |

## Decision

- screenshot: ships
- outline: ships
- text+shot+outline raises visual successRate by >=15 points or cuts meanTurns by >=25% versus text, without regression in visual or edit successRate: the screenshot ships
- text+shot+outline beats text+shot on visual successRate or meanTurns: the outline stays
