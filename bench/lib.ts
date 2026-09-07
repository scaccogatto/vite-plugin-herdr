import { absolutizeHint } from '../src/server.ts'
import type { ElementInfo } from '../src/types.ts'

/** The three payload variants under test (docs/payload.md) */
export type Variant = 'text' | 'text+shot' | 'text+shot+outline'
export const VARIANTS: Variant[] = ['text', 'text+shot', 'text+shot+outline']

/** One benchmark task from bench/tasks.json */
export interface Task {
  id: string
  kind: 'edit' | 'visual'
  selector: string
  prompt: string
  expectFile: string
  expectContains: string | null
  rubric?: string
}

/** One captured task fixture from bench/capture.ts, written to captures.json */
export interface Capture {
  taskId: string
  element: ElementInfo
  /** png path, relative to the run dir */
  shot: string | null
  /** png path, relative to the run dir */
  shotOutline: string | null
}

/** One task x variant x rep outcome, appended as a line to runs.jsonl */
export interface RunResult {
  taskId: string
  kind: 'edit' | 'visual'
  variant: Variant
  rep: number
  changedFiles: string[]
  rightFile: boolean
  success: boolean
  score: number | null
  numTurns: number | null
  durationMs: number | null
  costUsd: number | null
  isError: boolean
  note: string
}

/**
 * Inserts a `Screenshot: <pngPath>` line right before the `---` separator
 * line composePrompt emits; returns the prompt unchanged when pngPath is
 * null (or there is no separator line to anchor on)
 */
export function withScreenshot(prompt: string, pngPath: string | null): string {
  if (pngPath === null) return prompt

  const lines = prompt.split('\n')
  const dashIndex = lines.indexOf('---')
  if (dashIndex === -1) return prompt

  lines.splice(dashIndex, 0, `Screenshot: ${pngPath}`)
  return lines.join('\n')
}

/**
 * Rewrites a hint captured against the demo root (relative like
 * `Bench.vue:12:5 (data-v-inspector)`, or absolute under fromRoot) to an
 * absolute hint under toRoot; hints absolutizeHint can't place (no
 * `path:line` match) or null pass through unchanged
 */
export function rewriteHint(hint: string | null, fromRoot: string, toRoot: string): string | null {
  if (hint === null) return null

  const prefix = fromRoot.endsWith('/') ? fromRoot : `${fromRoot}/`
  const relative = hint.startsWith(prefix) ? hint.slice(prefix.length) : hint

  return absolutizeHint(relative, [toRoot])
}

type Kind = 'edit' | 'visual'
const KINDS: Kind[] = ['edit', 'visual']

/** Aggregate stats for one variant x kind slice of runs */
export interface KindStats {
  n: number
  successRate: number
  meanTurns: number | null
  meanDurationMs: number | null
  meanCostUsd: number | null
  rightFileRate: number
  errors: number
}

/** Per-variant, per-kind aggregate stats over a set of RunResults */
export type Summary = Record<Variant, Record<Kind, KindStats>>

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

function rate(count: number, n: number): number {
  return n === 0 ? 0 : count / n
}

function isNumber(x: number | null): x is number {
  return x !== null
}

/** Groups RunResults by variant x kind and computes success/turns/duration/cost/rightFile stats */
export function summarize(results: RunResult[]): Summary {
  const summary = {} as Summary

  for (const variant of VARIANTS) {
    const byKind = {} as Record<Kind, KindStats>

    for (const kind of KINDS) {
      const subset = results.filter((r) => r.variant === variant && r.kind === kind)
      const n = subset.length
      const errorCount = subset.filter((r) => r.isError).length
      const successfulRuns = subset.filter((r) => !r.isError)

      byKind[kind] = {
        n,
        successRate: rate(successfulRuns.filter((r) => r.success).length, successfulRuns.length),
        meanTurns: mean(successfulRuns.map((r) => r.numTurns).filter(isNumber)),
        meanDurationMs: mean(successfulRuns.map((r) => r.durationMs).filter(isNumber)),
        meanCostUsd: mean(successfulRuns.map((r) => r.costUsd).filter(isNumber)),
        rightFileRate: rate(successfulRuns.filter((r) => r.rightFile).length, successfulRuns.length),
        errors: errorCount,
      }
    }

    summary[variant] = byKind
  }

  return summary
}

const SUCCESS_RATE_BAR = 0.15
const TURNS_CUT_BAR = 0.25

/** Fraction by which `variant` cuts turns versus `base`; 0 when either mean is unavailable */
function turnsCut(base: number | null, variant: number | null): number {
  if (base === null || variant === null || base === 0) return 0
  return (base - variant) / base
}

function qualifies(base: KindStats, candidate: KindStats): boolean {
  // No regression in visual successRate AND (gain >=15 points OR cuts >=25% turns)
  if (candidate.successRate < base.successRate) return false
  const hasGain = candidate.successRate - base.successRate >= SUCCESS_RATE_BAR
  const hasTurnsCut = turnsCut(base.meanTurns, candidate.meanTurns) >= TURNS_CUT_BAR
  return hasGain || hasTurnsCut
}

function beats(base: KindStats, candidate: KindStats): boolean {
  if (candidate.successRate > base.successRate) return true
  return base.meanTurns !== null && candidate.meanTurns !== null && candidate.meanTurns < base.meanTurns
}

/** The docs/payload.md decision rule: does the screenshot, and the outline, enter the product */
export function decide(summary: Summary): { screenshot: boolean; outline: boolean; reasons: string[] } {
  const textVisual = summary['text'].visual
  const shotVisual = summary['text+shot'].visual
  const outlineVisual = summary['text+shot+outline'].visual
  const textEdit = summary['text'].edit
  const shotEdit = summary['text+shot'].edit
  const outlineEdit = summary['text+shot+outline'].edit

  // Screenshot qualifies if: no visual regression AND (gain >=15 or cut >=25%) AND no edit regression
  const shotQualifies =
    shotVisual.successRate >= textVisual.successRate &&
    qualifies(textVisual, shotVisual) &&
    shotEdit.successRate >= textEdit.successRate

  // Outline qualifies if: no visual regression AND (gain >=15 or cut >=25%) AND no edit regression
  const outlineQualifies =
    outlineVisual.successRate >= textVisual.successRate &&
    qualifies(textVisual, outlineVisual) &&
    outlineEdit.successRate >= textEdit.successRate

  const screenshot = shotQualifies || outlineQualifies

  const reasons: string[] = []
  if (screenshot) {
    const via = [shotQualifies && 'text+shot', outlineQualifies && 'text+shot+outline'].filter((v): v is string => v !== false)
    reasons.push(
      `${via.join(' and ')} raise${via.length === 1 ? 's' : ''} visual successRate by >=15 points or cut${via.length === 1 ? 's' : ''} meanTurns by >=25% versus text, without regression in visual or edit successRate: the screenshot ships`,
    )
  } else {
    // Explain why screenshot didn't qualify
    if (!shotQualifies) {
      if (shotVisual.successRate < textVisual.successRate) {
        reasons.push(
          `text+shot: visual successRate regressed from ${(textVisual.successRate * 100).toFixed(0)}% to ${(shotVisual.successRate * 100).toFixed(0)}% - rejected`,
        )
      } else if (shotEdit.successRate < textEdit.successRate) {
        reasons.push(
          `text+shot: edit successRate regressed from ${(textEdit.successRate * 100).toFixed(0)}% to ${(shotEdit.successRate * 100).toFixed(0)}% - rejected`,
        )
      } else {
        reasons.push(
          `text+shot: did not meet visual bar (no gain >=15 points or cut >=25% turns) - rejected`,
        )
      }
    }
    if (!outlineQualifies) {
      if (outlineVisual.successRate < textVisual.successRate) {
        reasons.push(
          `text+shot+outline: visual successRate regressed from ${(textVisual.successRate * 100).toFixed(0)}% to ${(outlineVisual.successRate * 100).toFixed(0)}% - rejected`,
        )
      } else if (outlineEdit.successRate < textEdit.successRate) {
        reasons.push(
          `text+shot+outline: edit successRate regressed from ${(textEdit.successRate * 100).toFixed(0)}% to ${(outlineEdit.successRate * 100).toFixed(0)}% - rejected`,
        )
      } else {
        reasons.push(
          `text+shot+outline: did not meet visual bar (no gain >=15 points or cut >=25% turns) - rejected`,
        )
      }
    }
  }

  // Outline only ships if it qualifies and beats text+shot
  const outline = outlineQualifies && screenshot && beats(shotVisual, outlineVisual)
  if (screenshot) {
    reasons.push(
      outline
        ? 'text+shot+outline beats text+shot on visual successRate or meanTurns: the outline stays'
        : 'text+shot+outline does not beat text+shot on visual successRate or meanTurns: the outline does not ship',
    )
  }

  return { screenshot, outline, reasons }
}

function fmtRate(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

function fmtNum(x: number | null, digits = 0): string {
  return x === null ? '-' : x.toFixed(digits)
}

function fmtCost(x: number | null): string {
  return x === null ? '-' : `$${x.toFixed(2)}`
}

/** Renders the per-variant x kind stats table plus the decision bullets as markdown */
export function renderSummary(summary: Summary, decision: ReturnType<typeof decide>): string {
  const lines: string[] = []

  lines.push('# Payload benchmark summary')
  lines.push('')
  lines.push('| Variant | Kind | n | successRate | meanTurns | meanDurationMs | meanCostUsd | rightFileRate | errors |')
  lines.push('|---|---|---|---|---|---|---|---|---|')

  for (const variant of VARIANTS) {
    for (const kind of KINDS) {
      const s = summary[variant][kind]
      lines.push(
        `| ${variant} | ${kind} | ${s.n} | ${fmtRate(s.successRate)} | ${fmtNum(s.meanTurns, 1)} | ${fmtNum(s.meanDurationMs)} | ${fmtCost(s.meanCostUsd)} | ${fmtRate(s.rightFileRate)} | ${s.errors} |`,
      )
    }
  }

  lines.push('')
  lines.push('## Decision')
  lines.push('')
  lines.push(`- screenshot: ${decision.screenshot ? 'ships' : 'does not ship'}`)
  lines.push(`- outline: ${decision.outline ? 'ships' : 'does not ship'}`)
  for (const reason of decision.reasons) lines.push(`- ${reason}`)

  return `${lines.join('\n')}\n`
}
