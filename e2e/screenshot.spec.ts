import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { startDemo, type DemoServer } from './helpers/servers.ts'
import { liveSnapshot } from './helpers/fixtures.ts'

// Never the real macOS `screencapture`: this fake just drops a fixed 1x1 PNG
// at its last argument, whatever crop region it was asked for.
const FAKE_SCREENCAPTURE = fileURLToPath(new URL('../src/__tests__/helpers/fake-screencapture.sh', import.meta.url))

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

test.describe('screenshot option off', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: liveSnapshot, plugin: { screenshot: false } })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test('the checkbox is absent when the plugin option is false', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)

    await arm(page)
    await pickTask(page, 'label')

    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
    // The row is always in the shadow DOM; renderAgents toggles its display
    // rather than adding/removing it, so assert hidden, not absent from the DOM.
    await expect(page.locator('[data-herdr-host] .shot-row')).toBeHidden()
  })
})

test.describe('screenshot option on', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({
      snapshot: liveSnapshot,
      plugin: { screenshot: true, screenshotCommand: FAKE_SCREENCAPTURE },
    })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`${demo.url}#bench`)
  })

  test('is present and unchecked, attaches a real capture when checked and sent', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')

    const checkbox = page.locator('[data-herdr-host] .shot-row input[type="checkbox"]')
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()

    await checkbox.check()
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to Fake agent')
    expect(await page.evaluate(() => window.__herdr?.screenshotEnabled())).toBe(true)

    const sent = demo.received()
    expect(sent).toHaveLength(1)
    const text = sent[0]!.text
    expect(text).toContain('Screenshot: ')

    const screenshotLine = text.split('\n').find((l) => l.startsWith('Screenshot: '))
    expect(screenshotLine).toBeDefined()
    const shotPath = screenshotLine!.slice('Screenshot: '.length).split(' (')[0]!
    expect(existsSync(shotPath)).toBe(true)
    expect(readFileSync(shotPath).length).toBeGreaterThan(0)
  })

  test('the checked state persists across a reload', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')

    const checkbox = page.locator('[data-herdr-host] .shot-row input[type="checkbox"]')
    await expect(checkbox).toBeVisible()
    await checkbox.check()

    await page.reload()
    await arm(page)
    await pickTask(page, 'label')

    const checkboxAfterReload = page.locator('[data-herdr-host] .shot-row input[type="checkbox"]')
    await expect(checkboxAfterReload).toBeVisible()
    await expect(checkboxAfterReload).toBeChecked()
  })
})
