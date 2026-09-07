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
    await page.keyboard.press('ArrowDown') // the list starts collapsed; expand it first
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

  test('the To field shows the preselected agent with its status and the list starts collapsed', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    const toRow = page.locator('[data-herdr-host] .to-row')
    await expect(toRow).toContainText('Settings polish')
    await expect(toRow).toContainText('idle')
    await expect(toRow).toContainText('main')
    await expect(toRow).toContainText('w1:p2')
    await expect(toRow).toHaveAttribute('aria-expanded', 'false')

    await expect(page.locator('[data-herdr-host] .agents-groups')).toBeHidden()
    await expect(page.locator('[data-herdr-host] [role="listbox"]')).toBeVisible()
  })

  test('the spawn rows are visible while collapsed', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    const here = page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' })
    const worktree = page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent in worktree' })
    await expect(here).toBeVisible()
    await expect(worktree).toBeVisible()
    await expect(here.locator('.spawn-hint')).toHaveText('split pane')
    await expect(worktree.locator('.spawn-hint')).toHaveText('new worktree')
  })

  test('Down expands the list without moving, then moves and the To field mirrors it', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    const toRow = page.locator('[data-herdr-host] .to-row')

    await page.keyboard.press('ArrowDown')
    await expect(toRow).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-herdr-host] .agents-groups')).toBeVisible()
    await expect(toRow).toContainText('Settings polish')

    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toContainText('Long task')
    await expect(toRow).toContainText('Long task')
    await expect(toRow).toContainText('working')

    await page.keyboard.press('ArrowUp')
    await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toContainText('Settings polish')
    await expect(toRow).toContainText('Settings polish')
    await expect(toRow).toContainText('idle')
  })

  test('clicking the To field toggles the list', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    const toRow = page.locator('[data-herdr-host] .to-row')
    const groups = page.locator('[data-herdr-host] .agents-groups')

    await toRow.click()
    await expect(toRow).toHaveAttribute('aria-expanded', 'true')
    await expect(groups).toBeVisible()

    await toRow.click()
    await expect(toRow).toHaveAttribute('aria-expanded', 'false')
    await expect(groups).toBeHidden()

    await toRow.click()
    await expect(groups).toBeVisible()
    await page.locator('[data-herdr-host] textarea').fill('typing should not collapse the list')
    await expect(groups).toBeVisible()
  })

  test('Enter on a spawn row with an empty prompt flashes invalid and spawns nothing', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    await page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' }).click()
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-herdr-host] textarea')).toHaveClass(/invalid/)
    expect(demo.received()).toEqual([])
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
  })

  test('clipboard mode shows Copy', async ({ context, page }) => {
    const clipboardDemo = await startDemo({ snapshot: null })
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${clipboardDemo.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')

      await expect(page.locator('[data-herdr-host] .send-btn')).toHaveText('Copy')
      await expect(page.locator('[data-herdr-host] .agents-notice')).toBeVisible()
      await expect(page.locator('[data-herdr-host] .spawn-row')).toHaveCount(0)
    } finally {
      await clipboardDemo.close()
    }
  })

  test('blocked settle shows the chip', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await page.keyboard.press('Enter')

    await expect.poll(() => page.evaluate(() => window.__herdr?.inflight())).toBe('w1:p2')
    await expect.poll(() => demo.fake!.subscriptionOpen()).toBe(true)
    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'working', title: 'Settings polish' },
    })
    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'blocked', title: 'Settings polish' },
    })

    await expect(page.locator('[data-herdr-host] .inflight-chip')).toHaveClass(/blocked/)
    await expect(page.locator('[data-herdr-host] .inflight-chip')).toContainText('blocked')
    await expect(page.locator('[data-herdr-host] .inflight')).toHaveClass(/blocked/)
  })

  test('narrow viewport hides the esc hint and the branch column, keeps Send visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await page.keyboard.press('ArrowDown') // expand so an agent row is on screen too

    await expect(page.locator('[data-herdr-host] .key-esc')).toBeHidden()
    await expect(page.locator('[data-herdr-host] .to-branch')).toBeHidden()
    const agentBranch = page.locator('[data-herdr-host] .agent-branch').first()
    await expect(agentBranch).toBeHidden()

    const popupBox = await page.locator('[data-herdr-host] .popup').boundingBox()
    const sendBox = await page.locator('[data-herdr-host] .send-btn').boundingBox()
    expect(popupBox).not.toBeNull()
    expect(sendBox).not.toBeNull()
    await expect(page.locator('[data-herdr-host] .send-btn')).toBeVisible()
    expect(sendBox!.x).toBeGreaterThanOrEqual(popupBox!.x)
    expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(popupBox!.x + popupBox!.width + 1)
  })

  test('no text under 12px except pane ids', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await page.keyboard.press('ArrowDown') // expand the list so agent/spawn rows are measured too

    const small = await page.evaluate(() => {
      const popup = document.querySelector('[data-herdr-host]')?.shadowRoot?.querySelector('.popup')
      if (popup === null || popup === undefined) return ['popup not found']
      const out: string[] = []
      for (const el of popup.querySelectorAll<HTMLElement>('*')) {
        if ((el.textContent ?? '').trim().length === 0 && el.tagName !== 'TEXTAREA') continue
        const fontSize = parseFloat(getComputedStyle(el).fontSize)
        if (fontSize < 12 && !el.classList.contains('agent-pane') && !el.classList.contains('to-pane')) {
          out.push(`${el.className || el.tagName} ${fontSize}px`)
        }
      }
      return out
    })
    expect(small).toEqual([])
  })
})
