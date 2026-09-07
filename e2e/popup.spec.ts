import { test, expect, type Page } from '@playwright/test'
import { startDemo, waitForPreselectedAgent, type DemoServer } from './helpers/servers.ts'
import { liveSnapshot } from './helpers/fixtures.ts'

// Interaction details of the popup itself: pointer send, keyboard focus
// inside the dialog, and how it holds its place against the viewport.

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

test.describe('popup interactions', () => {
  let demo: DemoServer

  test.beforeAll(async () => {
    demo = await startDemo({ snapshot: liveSnapshot })
  })

  test.afterAll(async () => {
    await demo.close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`${demo.url}#bench`)
  })

  test('the Send button sends to the selected agent, for pointer and touch users', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await waitForPreselectedAgent(page)

    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to')
    expect(demo.received().at(-1)?.text).toContain('Fix the typo')
  })

  test('Enter on a focused button activates that button instead of sending', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await waitForPreselectedAgent(page)
    const before = demo.received().length

    // the real route would launch an editor on the machine running the tests
    await page.route('**/__open-in-editor*', (route) => route.fulfill({ status: 200, body: '' }))
    await page.getByRole('button', { name: 'Open in editor' }).focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
    await expect(page.locator('[data-herdr-host] .toast')).toContainText('editor')
    expect(demo.received().length).toBe(before)
  })

  test('Tab stays inside the dialog and wraps around', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await expect(page.locator('[data-herdr-host] textarea')).toBeFocused()

    // Tab walks every visible control (the screenshot checkbox only exists on
    // macOS, so the count is not fixed) and comes back to the textarea without
    // ever leaving the picker's host
    const insideDialog = async (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.hasAttribute('data-herdr-host') === true)
    let steps = 0
    do {
      await page.keyboard.press('Tab')
      steps += 1
      expect(await insideDialog()).toBe(true)
    } while (steps < 8 && !(await page.locator('[data-herdr-host] textarea').evaluate((el) => el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).activeElement === el)))
    expect(steps).toBeGreaterThanOrEqual(4)
    expect(steps).toBeLessThan(8)

    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Open in editor' })).toBeFocused()
  })

  test('the popup stays inside a short viewport once the agent list has loaded', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 })
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    const popup = page.getByRole('dialog', { name: 'Send to herdr agent' })
    await expect
      .poll(async () => {
        const box = await popup.boundingBox()
        return box === null ? Infinity : box.y + box.height
      })
      .toBeLessThanOrEqual(420)
  })

  test('the picked outline follows the element while the page scrolls under the open popup', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    await page.mouse.wheel(0, 120)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect
      .poll(async () => {
        const target = await page.locator('#task-label').boundingBox()
        const outline = await page.locator('[data-herdr-host] .outline').boundingBox()
        return target === null || outline === null ? NaN : Math.abs(target.y - outline.y)
      })
      .toBeLessThan(1)
  })

  test('sending disables the form and restores it when herdr refuses', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await waitForPreselectedAgent(page)
    await page.locator('[data-herdr-host] [role="option"]', { hasText: 'Long task' }).click()

    await page.route('**/__herdr/prompt', async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'agent_blocked', message: 'blocked' }) })
    })
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Send to herdr agent' })
    await expect(dialog).toHaveClass(/sending/)
    await expect(page.locator('[data-herdr-host] .toast')).toContainText('waiting at a dialog')
    await expect(dialog).not.toHaveClass(/sending/)
    await expect(page.locator('[data-herdr-host] textarea')).toBeFocused()
  })
})
