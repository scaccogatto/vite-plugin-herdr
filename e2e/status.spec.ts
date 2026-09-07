import { test, expect, type Page } from '@playwright/test'
import { startDemo, type DemoServer } from './helpers/servers.ts'
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

  test('clears on idle with a finished toast', async ({ page }) => {
    const beforeSubscribe = subscribeCount(demo)
    await arm(page)
    await pickTask(page, 'label')
    await sendPrompt(page)

    await expect(page.locator('[data-herdr-host] .inflight')).toBeVisible()
    expect(await page.evaluate(() => window.__herdr?.inflight())).toBe('w1:p2')

    await waitForFreshSubscription(demo, beforeSubscribe)

    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'working', title: 'Settings polish' },
    })
    demo.fake!.pushEvent({
      event: 'pane.agent_status_changed',
      data: { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'idle', title: 'Settings polish' },
    })

    await expect(page.locator('[data-herdr-host] .toast')).toContainText('finished', { timeout: 5000 })
    await expect(page.locator('[data-herdr-host] .inflight')).toBeHidden()
    expect(await page.evaluate(() => window.__herdr?.inflight())).toBeNull()
  })

  test('shows a waiting toast when the pane blocks', async ({ page }) => {
    const beforeSubscribe = subscribeCount(demo)
    await arm(page)
    await pickTask(page, 'label')
    await sendPrompt(page)

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

      await page.getByRole('button', { name: '+ agent here' }).click()

      await expect(page.locator('[data-herdr-host] .toast')).toContainText('Started')
      const option = page.locator('[data-herdr-host] [role="option"][data-pane-id="w1:p9"]')
      await expect(option).toBeVisible()
      await expect(option).toHaveAttribute('aria-selected', 'true')
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

      await page.getByRole('button', { name: '+ agent here' }).click()

      // The real server message is "dev server is not running inside a herdr
      // pane"; assert the stable, herdr-pane-specific fragment of it.
      await expect(page.locator('[data-herdr-host] .toast')).toContainText('inside a herdr pane')
    } finally {
      await demo.close()
      if (prevPaneId !== undefined) process.env.HERDR_PANE_ID = prevPaneId
    }
  })
})
