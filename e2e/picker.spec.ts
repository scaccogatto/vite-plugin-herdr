import { test, expect, type Page } from '@playwright/test'
import { assertExplicitSocketPath, startDemo, type DemoServer } from './helpers/servers.ts'
import { bothIdleSnapshot, liveSnapshot } from './helpers/fixtures.ts'

// Safety net: this suite drives the real /__herdr/* routes (the herdr()
// plugin from vite.config.demo.ts), so every server here MUST be started
// against a fake herdr Unix socket, never a developer's real
// HERDR_SOCKET_PATH - that could list real agents and type prompts into
// real sessions. startDemo asserts this on every call it makes; re-assert
// the guard itself here so a regression in that guard fails this whole file
// immediately, before any real server (and any real agent) could be touched.
test.beforeAll(() => {
  expect(() => assertExplicitSocketPath(undefined)).toThrow()
  expect(() => assertExplicitSocketPath('')).toThrow()
})

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
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: liveSnapshot })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)
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

    const sent = demo.received()
    expect(sent).toHaveLength(1)
    const prompt = sent[0]!
    expect(prompt.target).toBe('w1:p2')
    expect(prompt.text).toContain('[vite-plugin-herdr] ')
    expect(prompt.text).toMatch(/Focus: \/.*\/demo\/Bench\.vue:\d+:\d+ \(data-v-inspector\)/)
    expect(prompt.text).toContain('data-herdr-picked=""')
    expect(prompt.text).toContain('button#task-label')
    expect(prompt.text.split('---')[1]).toContain('Fix the typo')

    const last = await page.evaluate(() => localStorage.getItem('herdr:last'))
    expect(last !== null && JSON.parse(last)).toEqual({ pane_id: 'w1:p2', session: 's1' })
  })

  // Skipped: src/server.ts has no watchAgent (status watch) yet, so the real
  // routes never open an events.subscribe connection after a send. Unskip
  // once that lands.
  test.skip('subscribes to status events for the sent-to agent after a send', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to Fake agent')

    await expect
      .poll(
        () =>
          demo
            .raw()
            .some((r) => r.method === 'events.subscribe' && JSON.stringify(r.params).includes('w1:p2')),
        { timeout: 2000 },
      )
      .toBe(true)
  })

  test('escape closes the dialog and clears the outline; hotkey works with an input focused', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeHidden()
    await expect(page.locator('[data-herdr-host] .outline')).toBeHidden()

    await page.goto(`${demo.url}`)
    await page.locator('#name').click()
    await arm(page)
    await expect(page.locator('html')).toHaveCSS('cursor', 'crosshair')
  })
})

test.describe('picker with a blocked agent', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: liveSnapshot, promptError: { code: 'agent_blocked', message: 'blocked' } })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test('a blocked response shows a toast and keeps the dialog open', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)

    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('answer it first')
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
  })
})

test.describe('picker with herdr unreachable', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: null })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test('typing a prompt and pressing Enter copies the composed prompt to the clipboard', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)

    await arm(page)
    await pickTask(page, 'label')

    await expect(page.locator('[data-herdr-host] .agents-notice')).toContainText('no_socket')

    await page.locator('[data-herdr-host] textarea').fill('typo, should say Submit')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('copied')

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain('[vite-plugin-herdr] ')
    // The real vite-plugin-vue-inspector stamps data-v-inspector relative to
    // the repo root (vite.config.demo.ts's root is demo/), not to demo/ itself.
    expect(clipboardText).toContain('Focus: demo/Bench.vue:')
    expect(clipboardText).toContain('data-herdr-picked=""')
    expect(clipboardText).toContain('button#task-label')
    expect(clipboardText.split('---')[1]).toContain('typo, should say Submit')
  })
})

test.describe('picker honors a remembered agent', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: bothIdleSnapshot })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test('a remembered pane id wins over the default idle-in-workspace pick', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)
    await page.evaluate(() => localStorage.setItem('herdr:last', JSON.stringify({ pane_id: 'w1:p3', session: 's2' })))
    await page.reload()

    await arm(page)
    await pickTask(page, 'label')

    await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toContainText('Long task')
  })
})
