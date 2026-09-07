import { test, expect, type Page } from '@playwright/test'
import { startDemo, waitForPreselectedAgent, type DemoServer } from './helpers/servers.ts'
import { liveSnapshot } from './helpers/fixtures.ts'

// Interaction details of the popup itself: pointer send, keyboard focus
// inside the dialog, and how it holds its place against the viewport.

async function arm(page: Page): Promise<void> {
  await page.keyboard.press('Control+b')
}

async function pickTask(page: Page, id: string): Promise<void> {
  await pickSelector(page, `#task-${id}`)
}

async function pickSelector(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector)
  await locator.hover()
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`no bounding box for ${selector}`)
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
    const activeClass = async (): Promise<string> =>
      page.evaluate(() => {
        const root = document.querySelector('[data-herdr-host]')?.shadowRoot
        const active = root?.activeElement
        return active instanceof HTMLElement ? active.className : ''
      })
    let steps = 0
    const visited: string[] = []
    do {
      await page.keyboard.press('Tab')
      steps += 1
      expect(await insideDialog()).toBe(true)
      visited.push(await activeClass())
    } while (steps < 8 && !(await page.locator('[data-herdr-host] textarea').evaluate((el) => el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).activeElement === el)))
    expect(steps).toBeGreaterThanOrEqual(4)
    expect(steps).toBeLessThan(8)
    // The new To field must be part of the cycle, not skipped over.
    expect(visited.some((c) => c.includes('to-row'))).toBe(true)

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

    // Expanding the agent list must not push the footer (and Send) out of
    // reach: .agents-groups scrolls internally instead of growing the popup.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[data-herdr-host] .agents-groups')).toBeVisible()

    const popupBox = await page.locator('[data-herdr-host] .popup').boundingBox()
    const sendBox = await page.locator('[data-herdr-host] .send-btn').boundingBox()
    expect(popupBox).not.toBeNull()
    expect(sendBox).not.toBeNull()
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(popupBox!.y + popupBox!.height)
    expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(420)
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
    await expect(page.locator('[data-herdr-host] .send-btn')).toHaveText('Sending…')
    await expect(page.locator('[data-herdr-host] .send-btn')).toBeDisabled()
    await expect(page.locator('[data-herdr-host] .toast')).toContainText('waiting at a dialog')
    await expect(dialog).not.toHaveClass(/sending/)
    await expect(page.locator('[data-herdr-host] textarea')).toBeFocused()
  })

  test('Tab is trapped but frozen while sending', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await waitForPreselectedAgent(page)

    await page.route('**/__herdr/prompt', async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'agent_blocked', message: 'blocked' }) })
    })
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Send to herdr agent' })
    await expect(dialog).toHaveClass(/sending/)
    // Tab must not cycle focus onto the To field or Open in editor while a
    // request is in flight: Enter there would toggle the list / open the
    // editor mid-send. Read the shadow root's own activeElement right after
    // Tab, synchronously (not an auto-retrying matcher): the mocked request
    // resolves in 300ms and reopenAfterError() refocuses the textarea on its
    // own, which would otherwise mask a Tab that briefly moved focus away.
    await page.keyboard.press('Tab')
    const activeTag = await page.evaluate(() => {
      const root = document.querySelector('[data-herdr-host]')?.shadowRoot
      return root?.activeElement instanceof HTMLElement ? root.activeElement.tagName : null
    })
    expect(activeTag).toBe('TEXTAREA')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('waiting at a dialog')
  })

  test('arrow keys are frozen while sending', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    await waitForPreselectedAgent(page)

    await page.route('**/__herdr/prompt', async (route) => {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'agent_blocked', message: 'blocked' }) })
    })
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Send to herdr agent' })
    await expect(dialog).toHaveClass(/sending/)
    const toRow = page.locator('[data-herdr-host] .to-row')
    await expect(toRow).toHaveAttribute('aria-expanded', 'false')
    // Mirrors the Tab freeze above: ArrowDown must not expand the (dimmed,
    // pointer-events: none) list mid-request either.
    await page.keyboard.press('ArrowDown')
    await expect(toRow).toHaveAttribute('aria-expanded', 'false')

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('waiting at a dialog')
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
    // No env sets HERDR_WORKSPACE_ID for this demo (and the ambient one, if
    // any, never matches the fixture's w1/w2 ids), so the dev workspace
    // label is unknown and "here" falls back to the generic hint.
    await expect(here.locator('.spawn-hint')).toHaveText('split pane next to the dev server')
    await expect(worktree.locator('.spawn-hint')).toHaveText('fresh worktree')
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

  test('Enter/Space on the focused To field toggles the list, never a send', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
    const before = demo.received().length

    await page.locator('[data-herdr-host] .to-row').focus()
    await page.keyboard.press('Enter')

    const toRow = page.locator('[data-herdr-host] .to-row')
    await expect(toRow).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-herdr-host] .agents-groups')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
    expect(demo.received().length).toBe(before)

    await page.keyboard.press('Enter')
    await expect(toRow).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('Space')
    await expect(toRow).toHaveAttribute('aria-expanded', 'true')
    expect(demo.received().length).toBe(before)
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
    expect(demo.raw().some((r) => r.method === 'agent.start')).toBe(false)
    await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
  })

  test('Down/Up from no selection land on the first/last spawn row, not the second', async ({ context, page }) => {
    const blockedSnapshot = {
      ...liveSnapshot,
      snapshot: {
        ...liveSnapshot.snapshot,
        agents: liveSnapshot.snapshot.agents.map((a) => ({ ...a, agent_status: 'blocked' })),
      },
    }
    const demo2 = await startDemo({ snapshot: blockedSnapshot })
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo2.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')

      const toRow = page.locator('[data-herdr-host] .to-row')
      await expect(toRow).toContainText('choose an agent')

      await page.keyboard.press('ArrowDown') // collapsed: expand only, selection unchanged
      await expect(toRow).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('ArrowDown') // from nothing: the first selectable row
      await expect(toRow).toContainText('+ agent here')

      await page.keyboard.press('Escape')
      await arm(page) // Escape returns to idle mode; re-arm before the next pick
      await pickTask(page, 'label')
      await expect(toRow).toContainText('choose an agent')
      await page.keyboard.press('ArrowUp') // expand only
      await page.keyboard.press('ArrowUp') // from nothing: the last selectable row
      await expect(toRow).toContainText('+ agent in worktree')
    } finally {
      await demo2.close()
    }
  })

  test('with no agents at all, Down selects the first spawn row without expanding an empty strip', async ({ context, page }) => {
    const emptySnapshot = { ...liveSnapshot, snapshot: { ...liveSnapshot.snapshot, agents: [] } }
    const demo2 = await startDemo({ snapshot: emptySnapshot })
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo2.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')

      const toRow = page.locator('[data-herdr-host] .to-row')
      await expect(toRow).toContainText('choose an agent')

      await page.keyboard.press('ArrowDown')
      await expect(toRow).toContainText('+ agent here')
      await expect(toRow).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('[data-herdr-host] .agents-groups')).toBeHidden()

      await toRow.click()
      await expect(toRow).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await demo2.close()
    }
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
      await expect(page.locator('[data-herdr-host] .keys span').first()).toContainText('copy')
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
    await expect(page.locator('[data-herdr-host] .inflight-chip')).toBeVisible()
    await expect(page.locator('[data-herdr-host] .inflight')).toHaveClass(/blocked/)
    // Settled outlines (done/blocked) are solid; dashed means still working.
    await expect(page.locator('[data-herdr-host] .inflight')).toHaveCSS('border-style', 'solid')
  })

  test('hovering a blocked row does not tint it', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)
    await page.keyboard.press('ArrowDown') // expand

    // liveSnapshot's w2:p1 ("Waiting") is blocked: it must ignore hover the
    // same way it ignores clicks, not light up as if selectable.
    const blockedRow = page.locator('[data-herdr-host] [role="option"]', { hasText: 'Waiting' })
    await expect(blockedRow).toBeVisible()
    await blockedRow.hover()
    await expect(blockedRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })

  test('a picked element without its own id shows the ancestor path', async ({ page }) => {
    await arm(page)
    // .note-text has no id of its own (its parent p#task-color does), so
    // selectorPath climbs past it: this is the only demo target that
    // exercises .popup-path at all (every #task-* element stops the climb
    // at itself). Picked at the default (wide) viewport - the sentence
    // wraps at 390px, and clicking a wrapped inline element's bounding-box
    // center misses the text and hits the paragraph instead.
    await pickSelector(page, '.note-text')
    await waitForPreselectedAgent(page)

    await expect(page.locator('[data-herdr-host] .popup-path')).toBeVisible()
    await expect(page.locator('[data-herdr-host] .popup-path')).toContainText('in ')
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

  test('a long popup hint ellipsizes instead of overflowing the header', async ({ page }) => {
    // Real case: an absolute-path source hint (e.g. from a deeply nested
    // worktree) is long enough to run past the header's inset. Stamp the
    // element's own data-v-inspector attribute (the real mechanism
    // sourceHint reads first) with such a path so the case reproduces
    // deterministically, independent of this checkout's own directory depth.
    const longPath = '../../../../../../../Users/gatto/Developer/scaccogatto/vite-plugin-herdr/demo/Bench.vue:17:7'
    await page.locator('#task-link').evaluate((el, v) => el.setAttribute('data-v-inspector', v), longPath)

    await arm(page)
    await pickTask(page, 'link')
    await waitForPreselectedAgent(page)

    const header = page.locator('[data-herdr-host] .popup-header')
    const hint = page.locator('[data-herdr-host] .popup-hint')
    await expect(hint).toContainText('Bench.vue')
    const headerBox = await header.boundingBox()
    const hintBox = await hint.boundingBox()
    expect(headerBox).not.toBeNull()
    expect(hintBox).not.toBeNull()
    // The hint's own box must never run past the header's inset (the popup
    // clips at its rounded border with no ellipsis otherwise).
    expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1)

    // The stamped path is long enough that the hint truly overflows its box
    // - proves the ellipsis is doing something, not that the hint was short.
    const overflowing = await hint.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflowing).toBe(true)
  })

  test('the hover chip truncates a long hint from the start, keeping the file name and line:col', async ({ page }) => {
    // Same long-path stamp as the header test above, but hovered (not
    // picked): the chip's own 60-char cap used to truncate from the end,
    // losing exactly the file name/line:col the header keeps.
    const longPath = '../../../../../../../Users/gatto/Developer/scaccogatto/vite-plugin-herdr/demo/Bench.vue:17:7'
    await page.locator('#task-link').evaluate((el, v) => el.setAttribute('data-v-inspector', v), longPath)

    await arm(page)
    await page.locator('#task-link').hover()

    const hint = page.locator('[data-herdr-host] .chip span')
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText(/Bench\.vue:17:7$/)
  })

  test('the hint right-aligns under Open in editor when there is no ancestor path', async ({ page }) => {
    await arm(page)
    await pickTask(page, 'label')
    await waitForPreselectedAgent(page)

    // #task-label has an id, so selectorPath stops there: no ancestor path,
    // .popup-path is hidden, and the hint must still sit under the editor
    // button rather than sliding to the left edge.
    await expect(page.locator('[data-herdr-host] .popup-path')).toBeHidden()
    const hintBox = await page.locator('[data-herdr-host] .popup-hint').boundingBox()
    const editorBox = await page.locator('[data-herdr-host] .popup-editor-btn').boundingBox()
    expect(hintBox).not.toBeNull()
    expect(editorBox).not.toBeNull()
    expect(Math.abs(hintBox!.x + hintBox!.width - (editorBox!.x + editorBox!.width))).toBeLessThanOrEqual(1)
  })

  test('the hover chip stays inside a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await arm(page)
    await page.locator('#task-label').hover()

    const chip = page.locator('[data-herdr-host] .chip')
    await expect(chip).toBeVisible()
    const box = await chip.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  })

  test('the hover chip keeps the full location text at a narrow viewport, clipping the label first', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await arm(page)
    await page.locator('#task-label').hover()

    const chip = page.locator('[data-herdr-host] .chip')
    await expect(chip).toBeVisible()
    // The hint (file:line:col) is the more useful half of the chip: it must
    // render in full, even if that means the label clips first.
    const hint = chip.locator('span')
    const hintNotClipped = await hint.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(hintNotClipped).toBe(true)
    await expect(hint).toHaveText(/:\d+:\d+$/)
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
