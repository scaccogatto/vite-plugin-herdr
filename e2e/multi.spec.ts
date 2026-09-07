import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import { startDemo, waitForPreselectedAgent, type DemoServer } from './helpers/servers.ts'
import { liveSnapshot } from './helpers/fixtures.ts'

// The real demo markup (Vue's data-v-inspector + data-v-* attrs on every
// tag) makes three elements' combined snippet comfortably exceed the
// plugin's default 1500-char inline cutoff, so the extras land in the
// attachment file (## Element N) rather than inline (Element N:) - both are
// the composed prompt, just routed differently; read whichever one herdr
// actually received.
async function sentBody(text: string): Promise<string> {
  const detailsLine = text.split('\n').find((l) => l.startsWith('Details: '))
  if (detailsLine === undefined) return text
  return readFile(detailsLine.slice('Details: '.length), 'utf8')
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

// page.mouse.click has no `modifiers` option (that's a locator/page.click
// thing); hold Shift on the keyboard around a plain mouse click instead, so
// the click event Playwright dispatches carries shiftKey: true.
async function shiftClickTask(page: Page, id: string): Promise<void> {
  const locator = page.locator(`#task-${id}`)
  await locator.hover()
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`no bounding box for #task-${id}`)
  await page.keyboard.down('Shift')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.up('Shift')
}

test.describe('multi-select with live agents', () => {
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

  test('shift+click adds elements to the selection, then a plain click opens the dialog with all of them', async ({
    page,
  }) => {
    await arm(page)

    await shiftClickTask(page, 'label')
    await shiftClickTask(page, 'link')

    await expect(page.locator('[data-herdr-host] .multi')).toHaveCount(2)
    const badges = page.locator('[data-herdr-host] .multi-badge')
    await expect(badges.nth(0)).toHaveText('1')
    await expect(badges.nth(1)).toHaveText('2')

    const selection = await page.evaluate(() => window.__herdr?.selection())
    expect(selection).toHaveLength(2)

    await pickTask(page, 'aria')

    const dialog = page.getByRole('dialog', { name: 'Send to herdr agent' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('3 elements')

    await waitForPreselectedAgent(page)
    await page.locator('[data-herdr-host] textarea').fill('Fix these together')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to Settings polish')

    const sent = demo.received()
    expect(sent).toHaveLength(1)
    const text = sent[0]!.text
    expect(text).toContain('button#task-label')

    const body = await sentBody(text)
    expect(body).toContain('Element 2')
    expect(body).toContain('Element 3')
    expect(body).toContain('data-herdr-picked="2"')
    expect(body).toContain('data-herdr-picked="3"')
  })

  test('multi-select boxes sit under the popup in shadow-root paint order', async ({ page }) => {
    await arm(page)
    await shiftClickTask(page, 'label')
    await pickTask(page, 'link')

    const order = await page.evaluate(() => {
      const shadow = document.querySelector('[data-herdr-host]')?.shadowRoot
      if (shadow === undefined || shadow === null) return []
      return [...shadow.children].map((el) => el.className)
    })
    const multiIdx = order.findIndex((c) => c.split(' ').includes('multi'))
    const popupIdx = order.findIndex((c) => c.split(' ').includes('popup'))
    expect(multiIdx).toBeGreaterThanOrEqual(0)
    expect(popupIdx).toBeGreaterThanOrEqual(0)
    // Later siblings paint on top: the box must come before the popup so the
    // popup (and its own chrome) is never covered by a stray selection box.
    expect(multiIdx).toBeLessThan(popupIdx)
  })

  test('Esc while picking clears the selection', async ({ page }) => {
    await arm(page)
    await shiftClickTask(page, 'label')

    await expect(page.locator('[data-herdr-host] .multi')).toHaveCount(1)

    await page.keyboard.press('Escape')

    await expect(page.locator('[data-herdr-host] .multi')).toHaveCount(0)
    const selection = await page.evaluate(() => window.__herdr?.selection())
    expect(selection).toEqual([])
  })
})

test.describe('multi-select without herdr', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: null })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test('clipboard mode composes the extras block too', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)

    await arm(page)
    await shiftClickTask(page, 'label')
    await pickTask(page, 'link')

    await page.locator('[data-herdr-host] textarea').fill('Fix these together')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('copied')

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain('Element 2:')
  })
})
