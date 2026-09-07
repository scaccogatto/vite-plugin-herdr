import { execSync, spawn } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { composePrompt } from '../src/compose.ts'
import { decide, renderSummary, rewriteHint, summarize, VARIANTS, withScreenshot } from './lib.ts'
import type { Capture, RunResult, Task, Variant } from './lib.ts'

const CLI_TIMEOUT_MS = 600000

const CLAUDE_MD = `This is a single headless benchmark run: edit the files in this directory in place to make the requested change, do not create git branches or worktrees, do not ask clarifying questions, do not start or run the dev server, and finish as soon as the change is made.\n`

interface Args {
  out: string
  variants: Variant[]
  reps: number
  tasks: string[] | null
  model: string
  maxTurns: number
  dryRun: boolean
  reportOnly: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`)
    return idx === -1 ? undefined : argv[idx + 1]
  }
  const has = (name: string): boolean => argv.includes(`--${name}`)

  const out = get('out')
  if (out === undefined) throw new Error('usage: node bench/run.ts --out bench/results/<runId> [options]')

  const variantsArg = get('variants')
  const tasksArg = get('tasks')

  return {
    out: resolve(out),
    variants: variantsArg ? (variantsArg.split(',') as Variant[]) : VARIANTS,
    reps: Number(get('reps') ?? '1'),
    tasks: tasksArg ? tasksArg.split(',') : null,
    model: get('model') ?? 'sonnet',
    maxTurns: Number(get('max-turns') ?? '30'),
    dryRun: has('dry-run'),
    reportOnly: has('report-only'),
  }
}

async function readTasks(): Promise<Task[]> {
  const raw = await readFile(resolve(import.meta.dirname, 'tasks.json'), 'utf8')
  return JSON.parse(raw) as Task[]
}

async function readCaptures(outDir: string): Promise<Capture[]> {
  const path = join(outDir, 'captures.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new Error(`no captures.json in ${outDir} - run: node bench/capture.ts --out ${outDir}`)
  }
  return JSON.parse(raw) as Capture[]
}

async function loadDone(runsPath: string): Promise<Set<string>> {
  const done = new Set<string>()
  let content: string
  try {
    content = await readFile(runsPath, 'utf8')
  } catch {
    return done
  }

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const r = JSON.parse(line) as RunResult
      done.add(`${r.taskId}|${r.variant}|${r.rep}`)
    } catch {
      // ignore malformed lines
    }
  }

  return done
}

function filteredEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CLAUDECODE
  return env
}

/** Spawns the claude CLI, capturing stdout, with a hard kill after CLI_TIMEOUT_MS */
function runClaudeCli(args: string[], cwd: string): Promise<{ raw: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn('claude', args, { cwd, env: filteredEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', () => {
      // discarded: only stdout carries the --output-format json envelope
    })

    child.on('close', () => {
      clearTimeout(timer)
      resolvePromise({ raw: stdout, timedOut })
    })
  })
}

interface ClaudeEnvelope {
  num_turns?: number
  duration_ms?: number
  total_cost_usd?: number
  is_error?: boolean
  result?: string
}

function parseEnvelope(raw: string): { ok: true; data: ClaudeEnvelope } | { ok: false; snippet: string } {
  try {
    return { ok: true, data: JSON.parse(raw) as ClaudeEnvelope }
  } catch {
    return { ok: false, snippet: raw.slice(0, 200) }
  }
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim()
  const match = trimmed.match(/^```(?:json)?\n([\s\S]*?)\n```$/)
  return match?.[1] ?? trimmed
}

function getChangedFiles(cwd: string): string[] {
  const tracked = execSync('git diff --name-only', { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.length > 0)
  const untracked = execSync('git status --porcelain', { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
  return Array.from(new Set([...tracked, ...untracked]))
}

async function judge(task: Task, tmp: string, model: string): Promise<{ score: number | null; success: boolean; note: string }> {
  const rawDiff = execSync('git diff', { cwd: tmp, encoding: 'utf8' })
  const diff = rawDiff.length > 12000 ? rawDiff.slice(0, 12000) : rawDiff

  const template = await readFile(resolve(import.meta.dirname, 'judge.md'), 'utf8')
  const prompt = template
    .replaceAll('{{task}}', task.prompt)
    .replaceAll('{{rubric}}', task.rubric ?? '')
    .replaceAll('{{diff}}', diff)

  const { raw, timedOut } = await runClaudeCli(
    ['-p', prompt, '--model', model, '--output-format', 'json', '--max-turns', '1', '--allowedTools', ''],
    tmp,
  )
  if (timedOut) return { score: null, success: false, note: 'judge_timeout' }

  const envelope = parseEnvelope(raw)
  if (!envelope.ok || envelope.data.result === undefined) return { score: null, success: false, note: 'judge_unparsable' }

  try {
    const parsed = JSON.parse(stripCodeFences(envelope.data.result)) as { score: number; reason: string }
    if (parsed.score !== 0 && parsed.score !== 1 && parsed.score !== 2) throw new Error('score out of range')
    return { score: parsed.score, success: parsed.score === 2, note: parsed.reason }
  } catch {
    return { score: null, success: false, note: 'judge_unparsable' }
  }
}

async function buildResult(
  task: Task,
  variant: Variant,
  rep: number,
  tmp: string,
  raw: string,
  timedOut: boolean,
  model: string,
): Promise<RunResult> {
  const base = { taskId: task.id, kind: task.kind, variant, rep }
  const empty = { changedFiles: [] as string[], rightFile: false, success: false, score: null, numTurns: null, durationMs: null, costUsd: null }

  if (timedOut) return { ...base, ...empty, isError: true, note: 'timeout' }

  const envelope = parseEnvelope(raw)
  if (!envelope.ok) return { ...base, ...empty, isError: true, note: envelope.snippet }

  const { data } = envelope
  const changedFiles = getChangedFiles(tmp)
  const rightFile = changedFiles.includes(task.expectFile)

  let success: boolean
  let score: number | null = null
  let note = ''

  if (task.kind === 'edit') {
    const content = rightFile ? await readFile(join(tmp, task.expectFile), 'utf8').catch(() => '') : ''
    success = rightFile && task.expectContains !== null && content.includes(task.expectContains)
  } else {
    const judged = await judge(task, tmp, model)
    score = judged.score
    success = judged.success
    note = judged.note
  }

  return {
    ...base,
    changedFiles,
    rightFile,
    success,
    score,
    numTurns: data.num_turns ?? null,
    durationMs: data.duration_ms ?? null,
    costUsd: data.total_cost_usd ?? null,
    isError: Boolean(data.is_error),
    note,
  }
}

function formatCost(cost: number | null): string {
  return cost === null ? '?' : `$${cost.toFixed(2)}`
}

async function report(outDir: string): Promise<void> {
  const runsPath = join(outDir, 'runs.jsonl')
  const content = await readFile(runsPath, 'utf8').catch(() => '')
  const results: RunResult[] = content
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RunResult)

  const summary = summarize(results)
  const decision = decide(summary)
  const md = renderSummary(summary, decision)

  await writeFile(join(outDir, 'summary.json'), JSON.stringify({ summary, decision }, null, 2))
  await writeFile(join(outDir, 'summary.md'), md)
  console.log(md)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(args.out, { recursive: true })

  if (args.reportOnly) {
    await report(args.out)
    return
  }

  const allTasks = await readTasks()
  const tasks = args.tasks === null ? allTasks : allTasks.filter((t) => args.tasks?.includes(t.id))
  const captures = await readCaptures(args.out)

  const demoRoot = resolve(import.meta.dirname, '../demo')
  const runsPath = join(args.out, 'runs.jsonl')
  const done = await loadDone(runsPath)

  for (const task of tasks) {
    const capture = captures.find((c) => c.taskId === task.id)
    if (capture === undefined) throw new Error(`no capture for task "${task.id}" - run bench/capture.ts first`)

    for (const variant of args.variants) {
      for (let rep = 1; rep <= args.reps; rep++) {
        const key = `${task.id}|${variant}|${rep}`
        if (done.has(key)) continue

        const tmp = await mkdtemp(join(tmpdir(), 'herdr-bench-run-'))
        try {
          await cp(demoRoot, tmp, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') })
          // CLAUDE.md and the screenshot live inside the copy and are part of the
          // base commit, so the agent can read them without leaving its cwd and
          // they never show up as changed files.
          await writeFile(join(tmp, 'CLAUDE.md'), CLAUDE_MD, 'utf8')
          const shotSource =
            variant === 'text' ? null : variant === 'text+shot' ? capture.shot : capture.shotOutline
          let shotPath: string | null = null
          if (shotSource !== null) {
            await mkdir(join(tmp, '.herdr-bench'), { recursive: true })
            shotPath = join(tmp, '.herdr-bench', 'picked-element.png')
            await cp(resolve(args.out, shotSource), shotPath)
          }
          execSync('git init -q', { cwd: tmp })
          execSync('git add -A', { cwd: tmp })
          execSync('git -c user.name=bench -c user.email=bench@example.com commit -q -m base', { cwd: tmp })

          const element = { ...capture.element, hint: rewriteHint(capture.element.hint, demoRoot, tmp) }
          const prompt = withScreenshot(composePrompt(element, task.prompt), shotPath)

          if (args.dryRun) {
            if (rep === 1) {
              console.log(`--- ${task.id} ${variant} ---`)
              console.log(prompt)
            }
            continue
          }

          const { raw, timedOut } = await runClaudeCli(
            [
              '-p',
              prompt,
              '--output-format',
              'json',
              '--permission-mode',
              'acceptEdits',
              '--allowedTools',
              'Read,Edit,Write,Grep,Glob',
              '--max-turns',
              String(args.maxTurns),
              '--model',
              args.model,
            ],
            tmp,
          )

          const result = await buildResult(task, variant, rep, tmp, raw, timedOut, args.model)
          await appendFile(runsPath, `${JSON.stringify(result)}\n`, 'utf8')
          console.log(
            `${task.id} ${variant} rep${rep} ${result.success ? 'ok' : 'fail'} turns=${result.numTurns ?? '?'} cost=${formatCost(result.costUsd)}`,
          )
        } finally {
          await rm(tmp, { recursive: true, force: true })
        }
      }
    }
  }

  if (!args.dryRun) await report(args.out)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
