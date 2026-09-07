import { test, expect, type Page } from '@playwright/test'
import { startDemo, waitForPreselectedAgent, type DemoServer } from './helpers/servers.ts'
import { liveSnapshot } from './helpers/fixtures.ts'

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

async function sendPrompt(page: Page): Promise<void> {
  // Wait for the agent list's GET /state to resolve (a preselected agent
  // shows up as an aria-selected option) before sending: otherwise Enter can
  // race ahead of it and the client falls back to clipboard mode, which
  // never posts /prompt at all - not the race this file exists to cover.
  await expect(page.locator('[data-herdr-host] [role="option"][aria-selected="true"]')).toBeAttached()
  await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
  await page.keyboard.press('Enter')
}

function subscribeCount(demo: DemoServer): number {
  return demo.raw().filter((r) => r.method === 'events.subscribe').length
}

// The fake keeps only one live subscription socket, and demo is shared
// across tests in a describe (its `raw()` log accumulates across all of
// them), so "some events.subscribe happened" is trivially true after the
// first test. Wait for the count to move past a baseline taken before this
// test's own send instead, so events push at the socket this test opened.
async function waitForFreshSubscription(demo: DemoServer, before: number): Promise<void> {
  await expect.poll(() => subscribeCount(demo)).toBeGreaterThan(before)
}

// The client sets window.__herdr.inflight() synchronously, before the
// /prompt fetch even leaves the browser, so events for that pane are never
// dropped. Still wait for both this and waitForFreshSubscription before
// pushing test events: the fake only forwards pushEvent() once its own
// subscribe socket is live, regardless of client-side timing.
async function waitForInflight(page: Page, paneId: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__herdr?.inflight())).toBe(paneId)
}

test.describe('in-flight outline', () => {
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

  test('shows DONE on the element when the agent goes idle, then clears', async ({ page }) => {
    const beforeSubscribe = subscribeCount(demo)
    await arm(page)
    await pickTask(page, 'label')
    await sendPrompt(page)

    await expect(page.locator('[data-herdr-host] .inflight')).toBeVisible()

    await waitForInflight(page, 'w1:p2')
    await waitForFreshSubscription(demo, beforeSubscribe)

    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'working', title: 'Settings polish' },
    })
    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'idle', title: 'Settings polish' },
    })

    // The DONE chip sits on the element itself (the toast alone was easy to
    // miss), and stays a few seconds before the toast takes over.
    await expect(page.locator('[data-herdr-host] .inflight-chip')).toContainText('DONE')
    await expect(page.locator('[data-herdr-host] .inflight-chip')).toHaveClass(/done/)
    // Settled outlines are solid (dashed means "still working"); only the
    // still-dashed .inflight itself is the working state.
    await expect(page.locator('[data-herdr-host] .inflight')).toHaveCSS('border-style', 'solid')
    await expect(page.locator('[data-herdr-host] .toast')).toContainText('DONE', { timeout: 5000 })
    await expect(page.locator('[data-herdr-host] .inflight')).toBeHidden()
    expect(await page.evaluate(() => window.__herdr?.inflight())).toBeNull()
  })

  test('shows a waiting toast when the pane blocks', async ({ page }) => {
    const beforeSubscribe = subscribeCount(demo)
    await arm(page)
    await pickTask(page, 'label')
    await sendPrompt(page)

    await waitForInflight(page, 'w1:p2')
    await waitForFreshSubscription(demo, beforeSubscribe)

    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'working', title: 'Settings polish' },
    })
    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'blocked', title: 'Settings polish' },
    })

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('waiting for you', { timeout: 5000 })
  })
})

test.describe('spawn buttons', () => {
  test('spawn here starts a new agent and selects it', async ({ context, page }) => {
    const agents = [...liveSnapshot.snapshot.agents]
    const demo = await startDemo({
      snapshot: { ...liveSnapshot, snapshot: { ...liveSnapshot.snapshot, agents } },
      env: { HERDR_WORKSPACE_ID: 'w1', HERDR_PANE_ID: 'w1:p1' },
      handlers: {
        'pane.split': () => ({ type: 'pane_split', pane: { pane_id: 'w1:p9' } }),
        'agent.start': () => {
          agents.push({
            pane_id: 'w1:p9',
            workspace_id: 'w1',
            agent_status: 'idle',
            focused: false,
            agent: 'claude',
            cwd: null,
            terminal_title_stripped: 'Claude Code',
            tokens: { branch: ' main' },
            agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 's9' },
          })
          return { type: 'agent_started', agent: { pane_id: 'w1:p9' } }
        },
      },
    })

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')

      await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
      await page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' }).click()
      await expect(page.locator('[data-herdr-host] .to-row')).toContainText('+ agent here')
      await page.keyboard.press('Enter')

      // Enter dispatches the keydown synchronously but the spawn-then-send
      // is async (two fetches); wait for the toast (itself a poll) before
      // reading the fake herdr's request log or it can be checked too early.
      await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to')
      expect(demo.raw().some((r) => r.method === 'agent.start')).toBe(true)
      expect(demo.received().at(-1)?.target).toBe('w1:p9')
      const last = await page.evaluate(() => localStorage.getItem('herdr:last'))
      expect(last !== null && JSON.parse(last).pane_id).toBe('w1:p9')
      await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeHidden()
    } finally {
      await demo.close()
    }
  })

  test('spawn here without a herdr pane env shows an error toast', async ({ context, page }) => {
    // startDemo's env option only sets/restores the keys it's given; clear
    // HERDR_PANE_ID directly too, since a machine that runs this suite from
    // inside a real herdr pane (as herdr's own dev machines do) would
    // otherwise leak an ambient pane id into the plugin's process.env read.
    const prevPaneId = process.env.HERDR_PANE_ID
    delete process.env.HERDR_PANE_ID

    const demo = await startDemo({ snapshot: liveSnapshot })

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')

      await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
      await page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' }).click()
      await page.keyboard.press('Enter')

      // The real server message is "dev server is not running inside a herdr
      // pane"; assert the stable, herdr-pane-specific fragment of it.
      await expect(page.locator('[data-herdr-host] .toast')).toContainText('inside a herdr pane')
      await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeVisible()
      await expect(page.locator('[data-herdr-host] .popup')).not.toHaveClass(/sending/)
      expect(demo.received()).toEqual([])
      // The "starting agent…" notice was swapped back for the To row once the
      // reload re-picked an agent (Settings polish, the fixture's idle one).
      await expect(page.locator('[data-herdr-host] .to-row')).toBeVisible()
      await expect(page.locator('[data-herdr-host] .to-row')).toContainText('Settings polish')

      // A retry is still possible: picking the spawn row again puts it back
      // in the To field.
      await page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' }).click()
      await expect(page.locator('[data-herdr-host] .to-row')).toContainText('+ agent here')
    } finally {
      await demo.close()
      if (prevPaneId !== undefined) process.env.HERDR_PANE_ID = prevPaneId
    }
  })

  test('spawn rows are reachable by keyboard and Enter spawns then sends', async ({ context, page }) => {
    const agents = [...liveSnapshot.snapshot.agents]
    const demo = await startDemo({
      snapshot: { ...liveSnapshot, snapshot: { ...liveSnapshot.snapshot, agents } },
      env: { HERDR_WORKSPACE_ID: 'w1', HERDR_PANE_ID: 'w1:p1' },
      handlers: {
        'pane.split': () => ({ type: 'pane_split', pane: { pane_id: 'w1:p9' } }),
        'agent.start': () => {
          agents.push({
            pane_id: 'w1:p9',
            workspace_id: 'w1',
            agent_status: 'idle',
            focused: false,
            agent: 'claude',
            cwd: null,
            terminal_title_stripped: 'Claude Code',
            tokens: { branch: ' main' },
            agent_session: { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 's9' },
          })
          return { type: 'agent_started', agent: { pane_id: 'w1:p9' } }
        },
      },
    })

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')
      await waitForPreselectedAgent(page)

      await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
      // 1st ArrowDown: expand, no move (still Settings polish). 2nd: Long
      // task. 3rd: + agent here (the two spawn rows follow the agents in
      // selectableAgentIds order).
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await expect(page.locator('[data-herdr-host] .to-row')).toContainText('+ agent here')
      await expect(page.locator('[data-herdr-host] .to-row')).toContainText('split pane')

      await page.keyboard.press('Enter')

      // Enter dispatches the keydown synchronously but the spawn-then-send
      // is async (two fetches); wait for the toast (itself a poll) before
      // reading the fake herdr's request log or it can be checked too early.
      await expect(page.locator('[data-herdr-host] .toast')).toContainText('Sent to')
      expect(demo.raw().some((r) => r.method === 'agent.start')).toBe(true)
      expect(demo.received().at(-1)?.target).toBe('w1:p9')
      const last = await page.evaluate(() => localStorage.getItem('herdr:last'))
      expect(last !== null && JSON.parse(last).pane_id).toBe('w1:p9')
      await expect(page.getByRole('dialog', { name: 'Send to herdr agent' })).toBeHidden()
    } finally {
      await demo.close()
    }
  })

  test('Esc during a spawn cancels the pending continuation, nothing is sent', async ({ context, page }) => {
    const demo = await startDemo({ snapshot: liveSnapshot })

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`${demo.url}#bench`)
      await arm(page)
      await pickTask(page, 'label')
      await waitForPreselectedAgent(page)

      const before = demo.received().length
      const snapshotsBefore = demo.raw().filter((r) => r.method === 'session.snapshot').length
      await page.route('**/__herdr/spawn', async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, pane_id: 'w1:p9', name: 'x', workspace_id: 'w1' }),
        })
      })

      await page.locator('[data-herdr-host] textarea').fill('Fix the typo')
      await page.locator('[data-herdr-host] .spawn-row', { hasText: '+ agent here' }).click()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog', { name: 'Send to herdr agent' })
      await expect(dialog).toHaveClass(/sending/)
      await expect(page.locator('[data-herdr-host] .agents-notice')).toContainText('starting agent')

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // The delayed /spawn response lands regardless of Escape, and its own
      // success path always reloads the agent list (GET /state -> a fresh
      // session.snapshot call) before the sendSeq guard is even checked;
      // wait for that reload, the step immediately before the guard, rather
      // than a fixed timeout, so this only asserts once the continuation has
      // actually had its chance to (wrongly) send.
      await expect.poll(() => demo.raw().filter((r) => r.method === 'session.snapshot').length).toBeGreaterThan(snapshotsBefore)
      // ...then let the guarded continuation's own microtask tail finish.
      await page.waitForTimeout(50)

      expect(demo.received().length).toBe(before)
      expect(await page.evaluate(() => window.__herdr?.inflight() ?? null)).toBeNull()
    } finally {
      await demo.close()
    }
  })

})
