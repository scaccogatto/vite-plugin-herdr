import { describe, it, expect } from 'vitest'
import { decide, renderSummary, rewriteHint, summarize, withScreenshot, VARIANTS } from '../../bench/lib.ts'
import type { KindStats, RunResult, Summary, Variant } from '../../bench/lib.ts'
import { composePrompt } from '../compose.ts'
import type { ElementInfo } from '../types.ts'

const EL: ElementInfo = {
  url: 'http://localhost:3131/#bench',
  viewport: { w: 1280, h: 900 },
  hint: 'Bench.vue:12:5 (data-v-inspector)',
  path: 'body > button#task-label',
  rect: { x: 10, y: 20, w: 100, h: 30 },
  html: '<button id="task-label" data-herdr-picked="">Sumbit</button>',
  styles: { color: 'rgb(0, 0, 0)' },
}

describe('withScreenshot', () => {
  it('inserts a Screenshot line right before the --- separator', () => {
    const prompt = composePrompt(EL, 'fix it')
    const result = withScreenshot(prompt, '/tmp/run/label-shot.png')

    const lines = result.split('\n')
    const dashIndex = lines.indexOf('---')
    expect(lines[dashIndex - 1]).toBe('Screenshot: /tmp/run/label-shot.png')
    expect(result).toContain('fix it')
  })

  it('is unchanged when pngPath is null', () => {
    const prompt = composePrompt(EL, 'fix it')
    expect(withScreenshot(prompt, null)).toBe(prompt)
  })

  it('is unchanged when there is no --- separator to anchor on', () => {
    expect(withScreenshot('no separator here', '/tmp/x.png')).toBe('no separator here')
  })
})

describe('rewriteHint', () => {
  it('resolves a relative hint against toRoot', () => {
    const result = rewriteHint('Bench.vue:12:5 (data-v-inspector)', '/repo/demo', '/tmp/run-abc')
    expect(result).toBe('/tmp/run-abc/Bench.vue:12:5 (data-v-inspector)')
  })

  it('rewrites a hint absolute under fromRoot to be absolute under toRoot', () => {
    const result = rewriteHint('/repo/demo/Bench.vue:12:5 (data-v-inspector)', '/repo/demo', '/tmp/run-abc')
    expect(result).toBe('/tmp/run-abc/Bench.vue:12:5 (data-v-inspector)')
  })

  it('passes through a hint absolutizeHint cannot place', () => {
    const result = rewriteHint('react component X, no file', '/repo/demo', '/tmp/run-abc')
    expect(result).toBe('react component X, no file')
  })

  it('passes through null', () => {
    expect(rewriteHint(null, '/repo/demo', '/tmp/run-abc')).toBeNull()
  })
})

function result(overrides: Partial<RunResult>): RunResult {
  return {
    taskId: 'label',
    kind: 'edit',
    variant: 'text',
    rep: 1,
    changedFiles: ['Bench.vue'],
    rightFile: true,
    success: true,
    score: null,
    numTurns: 4,
    durationMs: 8000,
    costUsd: 0.1,
    isError: false,
    note: '',
    ...overrides,
  }
}

describe('summarize', () => {
  it('computes per-variant, per-kind stats', () => {
    const results: RunResult[] = [
      result({ taskId: 'label', kind: 'edit', variant: 'text', rep: 1, success: true, numTurns: 4, durationMs: 8000, costUsd: 0.1 }),
      result({ taskId: 'link', kind: 'edit', variant: 'text', rep: 1, success: false, rightFile: false, numTurns: 6, durationMs: 12000, costUsd: 0.2 }),
      result({ taskId: 'align', kind: 'visual', variant: 'text', rep: 1, success: true, score: 2, numTurns: 5, durationMs: 9000, costUsd: 0.15 }),
      result({ taskId: 'align', kind: 'visual', variant: 'text+shot', rep: 1, success: true, score: 2, numTurns: 3, durationMs: 6000, costUsd: 0.12 }),
    ]

    const summary = summarize(results)

    expect(summary['text'].edit.n).toBe(2)
    expect(summary['text'].edit.successRate).toBeCloseTo(0.5)
    expect(summary['text'].edit.rightFileRate).toBeCloseTo(0.5)
    expect(summary['text'].edit.meanTurns).toBeCloseTo(5)
    expect(summary['text'].edit.meanDurationMs).toBeCloseTo(10000)
    expect(summary['text'].edit.meanCostUsd).toBeCloseTo(0.15)

    expect(summary['text'].visual.n).toBe(1)
    expect(summary['text'].visual.successRate).toBe(1)

    expect(summary['text+shot'].visual.n).toBe(1)
    expect(summary['text+shot'].visual.meanTurns).toBeCloseTo(3)

    expect(summary['text+shot'].edit.n).toBe(0)
    expect(summary['text+shot'].edit.successRate).toBe(0)
    expect(summary['text+shot'].edit.meanTurns).toBeNull()

    expect(summary['text+shot+outline'].edit.n).toBe(0)
    expect(summary['text+shot+outline'].visual.n).toBe(0)
  })

  it('excludes error runs from success/turn stats but counts them in errors field', () => {
    const results: RunResult[] = [
      result({ taskId: 'label', kind: 'edit', variant: 'text', rep: 1, success: true, numTurns: 4, durationMs: 8000, costUsd: 0.1 }),
      result({ taskId: 'label', kind: 'edit', variant: 'text', rep: 2, isError: true, numTurns: null, durationMs: null, costUsd: null }),
      result({ taskId: 'label', kind: 'edit', variant: 'text', rep: 3, success: false, numTurns: 6, durationMs: 12000, costUsd: 0.2 }),
    ]

    const summary = summarize(results)

    expect(summary['text'].edit.n).toBe(3)
    expect(summary['text'].edit.errors).toBe(1)
    expect(summary['text'].edit.successRate).toBeCloseTo(0.5) // 1 success out of 2 non-error runs
    expect(summary['text'].edit.meanTurns).toBeCloseTo(5) // (4 + 6) / 2
  })
})

function stats(overrides: Partial<KindStats> = {}): KindStats {
  return { n: 3, successRate: 0, meanTurns: null, meanDurationMs: null, meanCostUsd: null, rightFileRate: 0, errors: 0, ...overrides }
}

function summaryFrom(cfg: Record<Variant, { visual: Partial<KindStats>; edit: Partial<KindStats> }>): Summary {
  return {
    text: { visual: stats(cfg.text.visual), edit: stats(cfg.text.edit) },
    'text+shot': { visual: stats(cfg['text+shot'].visual), edit: stats(cfg['text+shot'].edit) },
    'text+shot+outline': { visual: stats(cfg['text+shot+outline'].visual), edit: stats(cfg['text+shot+outline'].edit) },
  }
}

describe('decide', () => {
  it('promotes the screenshot on a successRate gain, and keeps the outline when it beats the screenshot', () => {
    const summary = summaryFrom({
      text: { visual: { successRate: 0.4, meanTurns: 10 }, edit: { successRate: 0.8 } },
      'text+shot': { visual: { successRate: 0.6, meanTurns: 9 }, edit: { successRate: 0.8 } },
      'text+shot+outline': { visual: { successRate: 0.7, meanTurns: 8 }, edit: { successRate: 0.8 } },
    })

    const decision = decide(summary)
    expect(decision.screenshot).toBe(true)
    expect(decision.outline).toBe(true)
  })

  it('promotes the screenshot on a turns cut, but drops the outline when it does not beat the screenshot', () => {
    const summary = summaryFrom({
      text: { visual: { successRate: 0.5, meanTurns: 12 }, edit: { successRate: 0.8 } },
      'text+shot': { visual: { successRate: 0.55, meanTurns: 8 }, edit: { successRate: 0.8 } },
      'text+shot+outline': { visual: { successRate: 0.5, meanTurns: 9 }, edit: { successRate: 0.8 } },
    })

    const decision = decide(summary)
    expect(decision.screenshot).toBe(true)
    expect(decision.outline).toBe(false)
  })

  it('does not promote the screenshot when it regresses the edit tasks', () => {
    const summary = summaryFrom({
      text: { visual: { successRate: 0.4, meanTurns: 10 }, edit: { successRate: 0.8 } },
      'text+shot': { visual: { successRate: 0.6, meanTurns: 9 }, edit: { successRate: 0.6 } },
      'text+shot+outline': { visual: { successRate: 0.65, meanTurns: 8 }, edit: { successRate: 0.6 } },
    })

    const decision = decide(summary)
    expect(decision.screenshot).toBe(false)
    expect(decision.outline).toBe(false)
  })

  it('rejects the screenshot when visual success rate regresses despite fewer turns', () => {
    const summary = summaryFrom({
      text: { visual: { successRate: 0.8, meanTurns: 10 }, edit: { successRate: 0.8 } },
      'text+shot': { visual: { successRate: 0.7, meanTurns: 5 }, edit: { successRate: 0.8 } },
      'text+shot+outline': { visual: { successRate: 0.75, meanTurns: 4 }, edit: { successRate: 0.8 } },
    })

    const decision = decide(summary)
    expect(decision.screenshot).toBe(false)
    expect(decision.outline).toBe(false)
  })
})

describe('renderSummary', () => {
  it('contains the variant names and the decision lines', () => {
    const summary = summaryFrom({
      text: { visual: { successRate: 0.4, meanTurns: 10 }, edit: { successRate: 0.8 } },
      'text+shot': { visual: { successRate: 0.6, meanTurns: 9 }, edit: { successRate: 0.8 } },
      'text+shot+outline': { visual: { successRate: 0.7, meanTurns: 8 }, edit: { successRate: 0.8 } },
    })
    const decision = decide(summary)
    const md = renderSummary(summary, decision)

    for (const variant of VARIANTS) expect(md).toContain(variant)
    expect(md).toContain('## Decision')
    expect(md).toContain('screenshot: ships')
    expect(md).toContain('outline: ships')
    for (const reason of decision.reasons) expect(md).toContain(reason)
  })
})
