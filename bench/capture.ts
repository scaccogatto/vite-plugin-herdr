import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import inspector from 'vite-plugin-vue-inspector'
import herdr from '../src/index.ts'
import type { ElementInfo } from '../src/types.ts'
import type { Capture, Task } from './lib.ts'

const VIEWPORT = { width: 1280, height: 900 }
const MARGIN = 40

function outArg(): string {
  const idx = process.argv.indexOf('--out')
  const value = idx === -1 ? undefined : process.argv[idx + 1]
  if (value === undefined) throw new Error('usage: node bench/capture.ts --out bench/results/<runId>')
  return resolve(value)
}

interface Clip {
  x: number
  y: number
  width: number
  height: number
}

/**
 * vite-plugin-vue-inspector stamps data-v-inspector paths relative to
 * process.cwd() (not the Vite root), so a script launched from the repo
 * root sees hints like "demo/Bench.vue:11:7" instead of "Bench.vue:11:7".
 * Strips that cwd-to-demoRoot prefix so captured hints stay relative to
 * demoRoot, as bench/lib.ts's rewriteHint expects.
 */
function normalizeHint(hint: string | null, demoRoot: string): string | null {
  if (hint === null) return null
  const cwdPrefix = relative(process.cwd(), demoRoot)
  if (cwdPrefix.length === 0 || cwdPrefix.startsWith('..')) return hint
  const prefix = `${cwdPrefix}${sep}`
  return hint.startsWith(prefix) ? hint.slice(prefix.length) : hint
}

function clipFor(el: ElementInfo): Clip {
  const left = Math.max(0, el.rect.x - MARGIN)
  const top = Math.max(0, el.rect.y - MARGIN)
  const right = Math.min(el.viewport.w, el.rect.x + el.rect.w + MARGIN)
  const bottom = Math.min(el.viewport.h, el.rect.y + el.rect.h + MARGIN)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

async function main(): Promise<void> {
  const outDir = outArg()
  await mkdir(outDir, { recursive: true })

  const tasks = JSON.parse(await readFile(resolve(import.meta.dirname, 'tasks.json'), 'utf8')) as Task[]

  const demoRoot = resolve(import.meta.dirname, '../demo')
  const socketDir = await mkdtemp(join(tmpdir(), 'herdr-bench-capture-'))
  const socketPath = join(socketDir, 'herdr.sock')

  const server = await createServer({
    configFile: false,
    root: demoRoot,
    plugins: [
      vue(),
      inspector({ enabled: false, toggleButtonVisibility: 'never', toggleComboKey: false, cleanHtml: false }),
      herdr({ socketPath }),
    ],
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'silent',
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server did not resolve a local url')

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: VIEWPORT })

  try {
    await page.goto(`${url}#bench`)
    await page.waitForFunction(() => window.__herdr !== undefined)

    const captures: Capture[] = []

    for (const task of tasks) {
      const captured = await page.evaluate((selector) => {
        const el = document.querySelector(selector)
        if (el === null) throw new Error(`not found: ${selector}`)
        el.scrollIntoView({ block: 'center' })
        return window.__herdr!.describe(el)
      }, task.selector)
      const element: ElementInfo = { ...captured, hint: normalizeHint(captured.hint, demoRoot) }

      const clip = clipFor(element)

      await page.evaluate(() => window.__herdr!.outline(null))
      await page.waitForTimeout(50)
      const shot = `${task.id}-shot.png`
      await page.screenshot({ path: join(outDir, shot), clip })

      await page.evaluate((selector) => {
        const el = document.querySelector(selector)
        if (el !== null) window.__herdr!.outline(el)
      }, task.selector)
      await page.waitForTimeout(50)
      const shotOutline = `${task.id}-shot-outline.png`
      await page.screenshot({ path: join(outDir, shotOutline), clip })

      captures.push({ taskId: task.id, element, shot, shotOutline })
      console.log(`${task.id} captured (hint: ${element.hint ?? 'none'})`)
    }

    await writeFile(join(outDir, 'captures.json'), JSON.stringify(captures, null, 2))
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
