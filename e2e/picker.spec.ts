import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { fakeBackend, liveState, downState } from './helpers/fake-backend.ts'
import type { StateResponse } from '../src/types.ts'

async function startServer(
  state: StateResponse,
  promptStatus?: (target: string) => number,
): Promise<{ server: ViteDevServer; url: string; received: unknown[] }> {
  const plugin = fakeBackend({ state, promptStatus })
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.demo.ts', import.meta.url)),
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'silent',
    plugins: [plugin],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server did not resolve a local url')
  return { server, url, received: plugin.received }
}

async function arm(page: Page): Promise<void> {
  await page.keyboard.press('Control+b')
}

async function pickTask(page: Page, id: string): Promise<void> {
  const locator = page.locator(`#task-${id}`)
  await locator.hover()
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`no bounding box for #task-${id}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.describe('picker with live agents', () => {
  let server: ViteDevServer
  let url: string
  let received: unknown[]

  test.beforeAll(async () => {
    const started = await startServer(liveState)
    server = started.server
    url = started.url
    received = started.received
  })

  test.afterAll(async () => {
    await server.close()
  })

  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}#bench`)
  })

  test('arming shows a crosshair cursor and hovering shows the outline chip', async ({ page }) => {
    await arm(page)
    await expect(page.locator('html')).toHaveCSS('cursor', 'crosshair')

    await page.locator('#task-label').hover()

    await expect(page.locator('[data-herdr-host] .outline')).toBeVisible()
    const chip = page.locator('[data-herdr-host] .chip')
    await expect(chip).toContainText('button#task-label')
    await expect(chip).toContainText('Bench.vue')
  })

  test('clicking opens the dialog with the textarea focused', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')

    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
    await expect(page.locator('[data-herdr-host] textarea')).toBeFocused()
    await expect(page.getByRole('button', { name: 'Open in editor' })).toBeVisible()
  })

  test('lists grouped agents with the idle agent preselected and supports arrow navigation', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')

    const listbox = page.locator('[data-herdr-host] [role="listbox"]')
    await expect(listbox).toContainText('app')
    await expect(listbox).toContainText('docs')

    const options = page.locator('[data-herdr-host] [role="option"]')
    await expect(options).toHaveCount(3)

    const waiting = page.locator('[data-herdr-host] [role="option"]', { hasText: 'Waiting' })
    await expect(waiting).toHaveAttribute('aria-disabled', 'true')

    const selected = page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')
    await expect(selected).toContainText('Settings polish')

    await page.keyboard.press('ArrowDown')
    await expect(selected).toContainText('Long task')

    await page.keyboard.press('ArrowDown')
    await expect(selected).toContainText('Long task')

    await page.keyboard.press('ArrowUp')
    await expect(selected).toContainText('Settings polish')
  })

  test('sends the prompt to the selected agent and remembers it for next time', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')

    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to Fake agent')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeHidden()

    expect(received).toHaveLength(1)
    const request = received[0] as { target: string; prompt: string; element: { hint: string; html: string; path: string } }
    expect(request.target).toBe('w1:p2')
    expect(request.prompt).toBe('Fix the typo')
    expect(request.element.hint).toContain('data-v-inspector')
    expect(request.element.html).toContain('data-herdr-picked')
    expect(request.element.path).toContain('button#task-label')

    const last = await page.evaluate(() => localStorage.getItem('herdr:last'))
    expect(last !== null && JSON.parse(last)).toEqual({ pane_id: 'w1:p2', session: 's1' })
  })

  test('escape closes the dialog and clears the outline; hotkey works with an input focused', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeHidden()
    await expect(page.locator('[data-herdr-host] .outline')).toBeHidden()

    await page.goto(`${url}`)
    await page.locator('#name').click()
    await arm(page)
    await expect(page.locator('html')).toHaveCSS('cursor', 'crosshair')
  })
})

test.describe('picker with a blocked agent', () => {
  let server: ViteDevServer
  let url: string

  test.beforeAll(async () => {
    const started = await startServer(liveState, () => 409)
    server = started.server
    url = started.url
  })

  test.afterAll(async () => {
    await server.close()
  })

  test('a blocked response shows a toast and keeps the dialog open', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}#bench`)

    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('answer it first')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
  })
})

test.describe('picker with herdr unreachable', () => {
  let server: ViteDevServer
  let url: string

  test.beforeAll(async () => {
    const started = await startServer(downState)
    server = started.server
    url = started.url
  })

  test.afterAll(async () => {
    await server.close()
  })

  test('typing a prompt and pressing Enter copies the composed prompt to the clipboard', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}#bench`)

    await arm(page)
    await pickTask(page, 'label')

    await expect(page.locator('[data-herdr-host] [role="listbox"]')).toContainText('herdr not reachable')

    await page.locator('[data-herdr-host] textarea').fill('typo, should say Submit')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('copied')

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain('[vite-plugin-herdr] ')
    expect(clipboardText).toContain('Focus:')
    expect(clipboardText).toContain('Bench.vue:')
    expect(clipboardText).toContain('data-herdr-picked=""')
    expect(clipboardText).toContain('button#task-label')
    expect(clipboardText.split('---')[1]).toContain('typo, should say Submit')
  })
})

test.describe('picker honors a remembered agent', () => {
  let server: ViteDevServer
  let url: string

  test.beforeAll(async () => {
    const bothIdle: StateResponse = liveState.herdr
      ? { ...liveState, agents: liveState.agents.map((a) => (a.pane_id === 'w1:p3' ? { ...a, agent_status: 'idle' as const } : a)) }
      : liveState
    const started = await startServer(bothIdle)
    server = started.server
    url = started.url
  })

  test.afterAll(async () => {
    await server.close()
  })

  test('a remembered pane id wins over the default idle-in-workspace pick', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${url}#bench`)
    await page.evaluate(() => localStorage.setItem('herdr:last', JSON.stringify({ pane_id: 'w1:p3', session: 's2' })))
    await page.reload()

    await arm(page)
    await pickTask(page, 'label')

    await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toContainText('Long task')
  })
})
