/// <reference types="vite/client" />
import type {
  AgentRow,
  ClientOptions,
  ElementInfo,
  ErrorResponse,
  PromptRequest,
  PromptResponse,
  SpawnResponse,
  StateResponse,
} from '../types.ts'
import { composePrompt } from '../compose.ts'
import { HOST_ATTR, deepElementFromPoint, describeElement, matchesHotkey, parseHotkey, sourceHint } from './dom.ts'
import { groupAgents, pickAgent, selectableIds } from './agents.ts'

/** Debug/bench API exposed on window.__herdr */
export interface HerdrApi {
  version: string
  describe(el: Element): ElementInfo
  outline(el: Element | null): void
  pick(el: Element, x: number, y: number): void
  close(): void
  /** The pane id currently shown in-flight, or null */
  inflight(): string | null
}

declare global {
  interface Window {
    __herdr?: HerdrApi
  }
}

type Mode = 'idle' | 'picking' | 'popup' | 'sending'

const LAST_KEY = 'herdr:last'
const EDITOR_HINT_RE = /^(.+?):(\d+)(?::(\d+))?/

interface Last {
  pane_id: string
  session: string | null
}

function readLast(): Last | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<Last>
    if (typeof parsed.pane_id !== 'string') return null
    return { pane_id: parsed.pane_id, session: typeof parsed.session === 'string' ? parsed.session : null }
  } catch {
    return null
  }
}

function writeLast(last: Last): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last))
  } catch {
    // storage unavailable (private mode, quota) - preselection just falls back next time
  }
}

function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const idPart = el.id.length > 0 ? `#${el.id}` : ''
  const classAttr = el.getAttribute('class')
  const classes = classAttr !== null ? classAttr.split(/\s+/).filter((c) => c.length > 0).slice(0, 2) : []
  const classPart = classes.length > 0 ? `.${classes.join('.')}` : ''
  return `${tag}${idPart}${classPart}`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

const STYLE = `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; }
* { box-sizing: border-box; }
.outline { position: fixed; display: none; border: 2px solid #cba6f7; background: rgba(203, 166, 247, 0.12); pointer-events: none; }
.chip { position: fixed; display: none; background: #1e1e2e; color: #cba6f7; border: 1px solid #45475a; border-radius: 4px; padding: 2px 6px; font-size: 11px; white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; }
.inflight { position: fixed; display: none; border: 2px dashed #f9e2af; background: rgba(249, 226, 175, 0.12); pointer-events: none; transition: border-color 0.2s, background-color 0.2s; }
.inflight-chip { position: fixed; display: none; background: #1e1e2e; color: #f9e2af; border: 1px solid #45475a; border-radius: 4px; padding: 2px 6px; font-size: 11px; white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.popup { position: fixed; display: none; flex-direction: column; width: 380px; background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); pointer-events: auto; }
.popup-header { padding: 10px 12px 6px; border-bottom: 1px solid #45475a; }
.popup-label { font-weight: 600; }
.popup-hint { color: #a6adc8; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.popup-editor-btn { margin-top: 4px; background: none; border: 1px solid #45475a; color: #cba6f7; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer; }
.popup textarea { display: block; width: calc(100% - 24px); margin: 8px 12px; padding: 6px 8px; background: #181825; color: #cdd6f4; border: 1px solid #45475a; border-radius: 6px; font: inherit; resize: vertical; }
.popup textarea.invalid { border-color: #f38ba8; }
.spawn-area { display: flex; gap: 6px; margin: 0 12px 8px; }
.spawn-btn { flex: 1; background: none; border: 1px solid #45475a; color: #cba6f7; border-radius: 4px; padding: 4px 6px; font-size: 11px; cursor: pointer; }
.spawn-btn:disabled { opacity: 0.5; cursor: default; }
.agents-area { max-height: 220px; overflow-y: auto; margin: 0 12px; border-top: 1px solid #45475a; }
.agents-notice { padding: 8px 0; color: #a6adc8; font-size: 12px; }
.agents-group-heading { padding: 6px 0 2px; color: #a6adc8; font-size: 11px; text-transform: uppercase; }
.agent-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.agent-row[aria-selected='true'] { background: rgba(203, 166, 247, 0.18); }
.agent-row[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-idle { background: #a6e3a1; }
.status-done { background: #89b4fa; }
.status-working { background: #f9e2af; }
.status-blocked { background: #f38ba8; }
.status-unknown { background: #6c7086; }
.agent-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-branch { color: #a6adc8; font-size: 11px; }
.agent-pane { color: #6c7086; font-size: 10px; }
.popup-footer { padding: 6px 12px; color: #a6adc8; font-size: 11px; border-top: 1px solid #45475a; }
.toast { position: fixed; display: none; right: 16px; bottom: 16px; background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 6px; padding: 8px 12px; font-size: 12px; pointer-events: none; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); max-width: 320px; }
.toast.error { border-color: #f38ba8; }
`

function boot(): void {
  const params = new URL(import.meta.url).searchParams
  const options: ClientOptions = {
    hotkey: params.get('hotkey') ?? 'ctrl+b',
    endpoint: params.get('endpoint') ?? '/__herdr',
    maxDepth: Number(params.get('maxDepth') ?? '3'),
    maxLines: Number(params.get('maxLines') ?? '60'),
  }
  const hotkey = parseHotkey(options.hotkey)

  const path = new URL(import.meta.url).pathname
  const idIndex = path.indexOf('/@id/')
  const base = idIndex === -1 ? '/' : path.slice(0, idIndex + 1)

  function apiUrl(name: string): string {
    return base.replace(/\/$/, '') + options.endpoint + '/' + name
  }

  function mount(): void {
    const host = document.createElement('div')
    host.setAttribute(HOST_ATTR, '')
    host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
    document.body.appendChild(host)

    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    shadow.appendChild(style)

    const outline = document.createElement('div')
    outline.className = 'outline'

    const chip = document.createElement('div')
    chip.className = 'chip'

    const inflightBox = document.createElement('div')
    inflightBox.className = 'inflight'

    const inflightChip = document.createElement('div')
    inflightChip.className = 'inflight-chip'

    const popup = document.createElement('div')
    popup.className = 'popup'
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', 'Send to herdr agent')

    const header = document.createElement('div')
    header.className = 'popup-header'
    const labelEl = document.createElement('div')
    labelEl.className = 'popup-label'
    const hintEl = document.createElement('div')
    hintEl.className = 'popup-hint'
    const editorBtn = document.createElement('button')
    editorBtn.type = 'button'
    editorBtn.className = 'popup-editor-btn'
    editorBtn.textContent = 'Open in editor'
    header.append(labelEl, hintEl, editorBtn)

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'What should change?'
    textarea.rows = 3
    textarea.maxLength = 4000

    const spawnArea = document.createElement('div')
    spawnArea.className = 'spawn-area'
    spawnArea.style.display = 'none'

    const spawnHereBtn = document.createElement('button')
    spawnHereBtn.type = 'button'
    spawnHereBtn.className = 'spawn-btn'
    spawnHereBtn.textContent = '+ agent here'

    const spawnWorktreeBtn = document.createElement('button')
    spawnWorktreeBtn.type = 'button'
    spawnWorktreeBtn.className = 'spawn-btn'
    spawnWorktreeBtn.textContent = '+ agent in worktree'

    spawnArea.append(spawnHereBtn, spawnWorktreeBtn)

    const agentsArea = document.createElement('div')
    agentsArea.className = 'agents-area'
    agentsArea.setAttribute('role', 'listbox')

    const footer = document.createElement('div')
    footer.className = 'popup-footer'
    footer.textContent = 'Enter send · Shift+Enter newline · ↑↓ agent · Esc close'

    popup.append(header, textarea, spawnArea, agentsArea, footer)

    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.setAttribute('role', 'status')
    toast.setAttribute('aria-live', 'polite')

    shadow.append(outline, chip, inflightBox, inflightChip, popup, toast)

    // --- mutable UI state -------------------------------------------------

    let mode: Mode = 'idle'
    let hoveredEl: Element | null = null
    let pickedEl: Element | null = null
    let pickedInfo: ElementInfo | null = null
    let lastPointerX = 0
    let lastPointerY = 0
    let prevFocus: Element | null = null
    let prevCursor = ''
    let editorMatch: string | null = null
    let toastTimer: ReturnType<typeof setTimeout> | undefined
    let pickToken = 0
    let currentStateResponse: StateResponse | null = null
    let selectableAgentIds: string[] = []
    let selectedPaneId: string | null = null

    let inflightPaneId: string | null = null
    let inflightTitle: string | null = null
    let inflightEl: Element | null = null
    let inflightSettleTimer: ReturnType<typeof setTimeout> | undefined
    let inflightPollTimer: ReturnType<typeof setInterval> | undefined

    // --- outline + chip -----------------------------------------------------

    function drawOutlineAt(el: Element): void {
      const rect = el.getBoundingClientRect()
      outline.style.display = 'block'
      outline.style.left = `${rect.left}px`
      outline.style.top = `${rect.top}px`
      outline.style.width = `${rect.width}px`
      outline.style.height = `${rect.height}px`

      const hint = sourceHint(el)
      const label = elementLabel(el)
      chip.textContent = hint !== null ? `${label} · ${truncate(hint, 60)}` : label
      chip.style.display = 'block'
      const chipRect = chip.getBoundingClientRect()
      const touchesTop = rect.top <= 0
      chip.style.left = `${rect.left}px`
      chip.style.top = touchesTop ? `${rect.bottom + 4}px` : `${rect.top - chipRect.height - 4}px`
    }

    function clearOutline(): void {
      outline.style.display = 'none'
      chip.style.display = 'none'
    }

    function updateHover(x: number, y: number): void {
      const el = deepElementFromPoint(x, y, host)
      if (el === hoveredEl) return
      hoveredEl = el
      if (el === null) {
        clearOutline()
        return
      }
      drawOutlineAt(el)
    }

    // --- in-flight outline -----------------------------------------------------
    // Independent of the hover outline above: it marks a picked element whose
    // prompt was sent, and stays until the target agent settles.

    function inflightLabel(): string {
      return inflightTitle ?? inflightPaneId ?? ''
    }

    function renderInflightChip(): void {
      inflightChip.textContent = `→ ${inflightLabel()} · working…`
    }

    function positionInflight(): void {
      if (inflightEl === null) return
      // isConnected (not document.contains) so a shadow-DOM-hosted picked
      // element (deepElementFromPoint supports those) isn't wrongly cleared
      if (!inflightEl.isConnected) {
        clearInflight()
        return
      }
      const rect = inflightEl.getBoundingClientRect()
      inflightBox.style.left = `${rect.left}px`
      inflightBox.style.top = `${rect.top}px`
      inflightBox.style.width = `${rect.width}px`
      inflightBox.style.height = `${rect.height}px`

      const chipRect = inflightChip.getBoundingClientRect()
      const touchesTop = rect.top <= 0
      inflightChip.style.left = `${rect.left}px`
      inflightChip.style.top = touchesTop ? `${rect.bottom + 4}px` : `${rect.top - chipRect.height - 4}px`
    }

    function stopInflightPoll(): void {
      if (inflightPollTimer === undefined) return
      clearInterval(inflightPollTimer)
      inflightPollTimer = undefined
    }

    function clearInflight(): void {
      inflightPaneId = null
      inflightTitle = null
      inflightEl = null
      inflightBox.style.display = 'none'
      inflightBox.style.borderColor = ''
      inflightChip.style.display = 'none'
      if (inflightSettleTimer !== undefined) {
        clearTimeout(inflightSettleTimer)
        inflightSettleTimer = undefined
      }
      stopInflightPoll()
    }

    function settleInflightFinished(): void {
      const label = inflightLabel()
      inflightBox.style.borderColor = '#a6e3a1'
      inflightChip.style.display = 'none'
      stopInflightPoll()
      if (inflightSettleTimer !== undefined) clearTimeout(inflightSettleTimer)
      inflightSettleTimer = setTimeout(() => {
        showToast(`${label} finished`)
        clearInflight()
      }, 1200)
    }

    function settleInflightBlocked(): void {
      const label = inflightLabel()
      inflightBox.style.borderColor = '#f38ba8'
      inflightChip.style.display = 'none'
      stopInflightPoll()
      showToast(`${label} is waiting for you in herdr`)
      if (inflightSettleTimer !== undefined) clearTimeout(inflightSettleTimer)
      inflightSettleTimer = setTimeout(() => clearInflight(), 3000)
    }

    // Fallback for consumers without HMR (import.meta.hot undefined): poll
    // state and derive the same working -> settled transition a herdr:status
    // event would have given us.
    function startInflightPoll(paneId: string): void {
      const startedAt = Date.now()
      let sawWorking = false

      inflightPollTimer = setInterval(() => {
        if (inflightPaneId !== paneId || Date.now() - startedAt > 30 * 60 * 1000) {
          stopInflightPoll()
          return
        }
        void (async () => {
          try {
            const res = await fetch(apiUrl('state'), { credentials: 'same-origin' })
            const data = (await res.json()) as StateResponse
            if (inflightPaneId !== paneId || !data.herdr) return
            const row = data.agents.find((a) => a.pane_id === paneId)
            if (row === undefined) return
            if (row.title !== null) inflightTitle = row.title

            if (row.agent_status === 'working') {
              sawWorking = true
              renderInflightChip()
              return
            }
            const settled = row.agent_status === 'idle' || row.agent_status === 'done' || row.agent_status === 'blocked'
            if (!settled || (!sawWorking && Date.now() - startedAt < 5000)) return

            if (row.agent_status === 'blocked') settleInflightBlocked()
            else settleInflightFinished()
          } catch {
            // network hiccup: try again next tick
          }
        })()
      }, 2000)
    }

    function startInflight(paneId: string, title: string | null, el: Element): void {
      stopInflightPoll()
      if (inflightSettleTimer !== undefined) {
        clearTimeout(inflightSettleTimer)
        inflightSettleTimer = undefined
      }
      inflightPaneId = paneId
      inflightTitle = title
      inflightEl = el
      inflightBox.style.borderColor = ''
      inflightBox.style.display = 'block'
      renderInflightChip()
      inflightChip.style.display = 'block'
      positionInflight()
      if (!import.meta.hot) startInflightPoll(paneId)
    }

    function handleStatusEvent(event: { pane_id: string; agent_status: string; title: string | null }): void {
      if (event.pane_id !== inflightPaneId) return
      if (event.title !== null) inflightTitle = event.title

      if (event.agent_status === 'working') {
        renderInflightChip()
        return
      }
      if (event.agent_status === 'blocked') {
        settleInflightBlocked()
        return
      }
      // idle/done settle; unknown (matching the poll fallback and the
      // server's own watchAgent, which also keeps watching on unknown) does not
      if (event.agent_status === 'idle' || event.agent_status === 'done') settleInflightFinished()
    }

    if (import.meta.hot) {
      import.meta.hot.on('herdr:status', (event: { pane_id: string; agent_status: string; title: string | null }) => {
        handleStatusEvent(event)
      })
    }

    // --- mode transitions -----------------------------------------------------

    function restoreCursor(): void {
      document.documentElement.style.cursor = prevCursor
    }

    function enterPicking(): void {
      mode = 'picking'
      prevCursor = document.documentElement.style.cursor
      document.documentElement.style.cursor = 'crosshair'
    }

    function exitPicking(): void {
      mode = 'idle'
      restoreCursor()
      clearOutline()
      hoveredEl = null
    }

    function close(): void {
      popup.style.display = 'none'
      clearOutline()
      hoveredEl = null
      pickedEl = null
      pickedInfo = null
      restoreCursor()
      if (prevFocus instanceof HTMLElement) prevFocus.focus()
      prevFocus = null
      mode = 'idle'
    }

    // --- toast -----------------------------------------------------

    function showToast(message: string, isError = false): void {
      toast.textContent = message
      toast.classList.toggle('error', isError)
      toast.style.display = 'block'
      if (toastTimer !== undefined) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        toast.style.display = 'none'
      }, 3000)
    }

    function flashInvalid(): void {
      textarea.classList.add('invalid')
      setTimeout(() => textarea.classList.remove('invalid'), 400)
    }

    // --- clipboard fallback -----------------------------------------------------

    async function copyText(text: string): Promise<void> {
      if (navigator.clipboard?.writeText !== undefined) {
        try {
          await navigator.clipboard.writeText(text)
          return
        } catch {
          // fall through to the execCommand fallback below
        }
      }
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position: fixed; opacity: 0;'
      shadow.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      shadow.removeChild(ta)
    }

    // --- agents list -----------------------------------------------------

    function showAgentsNotice(text: string): void {
      agentsArea.innerHTML = ''
      const notice = document.createElement('div')
      notice.className = 'agents-notice'
      notice.textContent = text
      agentsArea.appendChild(notice)
    }

    function showAgentsLoading(): void {
      showAgentsNotice('loading agents...')
    }

    function updateSelection(): void {
      const rows = agentsArea.querySelectorAll<HTMLElement>('.agent-row')
      for (const row of rows) {
        const isSelected = row.dataset.paneId === selectedPaneId
        row.setAttribute('aria-selected', String(isSelected))
        if (isSelected) row.scrollIntoView({ block: 'nearest' })
      }
    }

    function renderAgentRow(agent: AgentRow): HTMLElement {
      const row = document.createElement('div')
      row.className = 'agent-row'
      row.setAttribute('role', 'option')
      row.dataset.paneId = agent.pane_id

      const blocked = agent.agent_status === 'blocked'
      if (blocked) row.setAttribute('aria-disabled', 'true')

      const dot = document.createElement('span')
      dot.className = `status-dot status-${agent.agent_status}`

      const title = document.createElement('span')
      title.className = 'agent-title'
      title.textContent = agent.title ?? `${agent.agent ?? 'agent'} ${agent.pane_id}`

      const branch = document.createElement('span')
      branch.className = 'agent-branch'
      branch.textContent = agent.branch ?? ''

      const pane = document.createElement('span')
      pane.className = 'agent-pane'
      pane.textContent = agent.pane_id

      row.append(dot, title, branch, pane)

      row.addEventListener('click', () => {
        if (blocked) return
        selectedPaneId = agent.pane_id
        updateSelection()
      })

      return row
    }

    function renderAgents(state: StateResponse): void {
      currentStateResponse = state
      agentsArea.innerHTML = ''
      spawnArea.style.display = state.herdr ? 'flex' : 'none'

      if (!state.herdr) {
        selectableAgentIds = []
        selectedPaneId = null
        const notice = document.createElement('div')
        notice.className = 'agents-notice'
        notice.textContent = `herdr not reachable (${state.reason}): Enter copies the prompt`
        agentsArea.appendChild(notice)
        return
      }

      const groups = groupAgents(state)
      selectableAgentIds = selectableIds(groups)
      selectedPaneId = pickAgent(state, readLast())

      for (const group of groups) {
        const heading = document.createElement('div')
        heading.className = 'agents-group-heading'
        const wsLabel = group.workspace.label ?? group.workspace.workspace_id
        heading.textContent = group.workspace.focused ? `${wsLabel} · focused` : wsLabel
        agentsArea.appendChild(heading)

        for (const agent of group.agents) agentsArea.appendChild(renderAgentRow(agent))
      }

      updateSelection()
    }

    async function loadAgents(token: number): Promise<void> {
      showAgentsLoading()
      try {
        const res = await fetch(apiUrl('state'), { credentials: 'same-origin' })
        const data = (await res.json()) as StateResponse
        if (token !== pickToken) return
        renderAgents(data)
      } catch {
        if (token !== pickToken) return
        renderAgents({ herdr: false, reason: 'network_error', message: 'could not reach the dev server' })
      }
    }

    async function requestSpawn(mode: 'here' | 'worktree'): Promise<void> {
      spawnHereBtn.disabled = true
      spawnWorktreeBtn.disabled = true
      showAgentsNotice('starting agent…')

      try {
        const res = await fetch(apiUrl('spawn'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ mode }),
        })

        if (res.status === 200) {
          const data = (await res.json()) as SpawnResponse
          pickToken += 1
          await loadAgents(pickToken)
          selectedPaneId = data.pane_id
          updateSelection()
          showToast(`Started ${data.name}`)
          return
        }

        const err = (await res.json()) as ErrorResponse
        showToast(err.message, true)
        pickToken += 1
        await loadAgents(pickToken)
      } catch {
        showToast('could not reach the dev server', true)
        pickToken += 1
        await loadAgents(pickToken)
      } finally {
        spawnHereBtn.disabled = false
        spawnWorktreeBtn.disabled = false
      }
    }

    spawnHereBtn.addEventListener('click', () => void requestSpawn('here'))
    spawnWorktreeBtn.addEventListener('click', () => void requestSpawn('worktree'))

    function moveSelection(delta: number): void {
      if (selectableAgentIds.length === 0) return
      const idx = selectedPaneId !== null ? selectableAgentIds.indexOf(selectedPaneId) : -1
      const base0 = idx === -1 ? 0 : idx
      const nextIdx = Math.max(0, Math.min(selectableAgentIds.length - 1, base0 + delta))
      selectedPaneId = selectableAgentIds[nextIdx] ?? null
      updateSelection()
    }

    // --- popup positioning + open/pick -----------------------------------------------------

    function positionPopup(x: number, y: number): void {
      const r = popup.getBoundingClientRect()
      let left = x + 12
      if (left + r.width > innerWidth - 8) left = x - 12 - r.width
      left = Math.max(8, Math.min(left, innerWidth - r.width - 8))

      let top = y + 12
      if (top + r.height > innerHeight - 8) top = y - 12 - r.height
      top = Math.max(8, Math.min(top, innerHeight - r.height - 8))

      popup.style.left = `${left}px`
      popup.style.top = `${top}px`
    }

    function openPopup(x: number, y: number): void {
      if (pickedEl === null || pickedInfo === null) return

      labelEl.textContent = elementLabel(pickedEl)
      hintEl.textContent = pickedInfo.hint ?? ''
      hintEl.style.display = pickedInfo.hint !== null ? '' : 'none'

      const match = pickedInfo.hint !== null ? pickedInfo.hint.match(EDITOR_HINT_RE) : null
      editorMatch = match !== null ? match[0] : null
      editorBtn.style.display = editorMatch !== null ? '' : 'none'

      textarea.value = ''
      currentStateResponse = null
      selectedPaneId = null
      spawnArea.style.display = 'none'

      popup.style.display = 'flex'
      positionPopup(x, y)
      textarea.focus()

      pickToken += 1
      void loadAgents(pickToken)
    }

    function pick(el: Element, x: number, y: number): void {
      pickedEl = el
      pickedInfo = describeElement(el, { maxDepth: options.maxDepth, maxLines: options.maxLines })
      prevFocus = document.activeElement
      drawOutlineAt(el)
      restoreCursor()
      mode = 'popup'
      openPopup(x, y)
    }

    // --- send -----------------------------------------------------

    function findSession(paneId: string): string | null {
      if (currentStateResponse === null || !currentStateResponse.herdr) return null
      return currentStateResponse.agents.find((a) => a.pane_id === paneId)?.session ?? null
    }

    async function send(): Promise<void> {
      const prompt = textarea.value.trim()
      if (prompt.length === 0) {
        flashInvalid()
        return
      }
      if (pickedInfo === null) return

      const clipboardMode = currentStateResponse === null || currentStateResponse.herdr === false
      if (clipboardMode) {
        await copyText(composePrompt(pickedInfo, prompt))
        showToast('Prompt copied to clipboard')
        close()
        return
      }

      if (selectedPaneId === null) {
        flashInvalid()
        return
      }

      const target = selectedPaneId
      mode = 'sending'
      const body: PromptRequest = { target, prompt, element: pickedInfo }

      try {
        const res = await fetch(apiUrl('prompt'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        })

        if (res.status === 200) {
          const data = (await res.json()) as PromptResponse
          const sentPaneId = data.pane_id ?? target
          const sentEl = pickedEl
          showToast(`Sent to ${data.title ?? data.target}`)
          writeLast({ pane_id: target, session: findSession(target) })
          close()
          if (sentEl !== null) startInflight(sentPaneId, data.title, sentEl)
          return
        }

        if (res.status === 409) {
          showToast('Agent is waiting at a dialog in herdr, answer it first', true)
          mode = 'popup'
          return
        }

        if (res.status === 404) {
          showToast('Agent is gone', true)
          mode = 'popup'
          pickToken += 1
          void loadAgents(pickToken)
          return
        }

        if (res.status === 400 || res.status === 413 || res.status === 415) {
          const err = (await res.json()) as ErrorResponse
          showToast(err.message, true)
          mode = 'popup'
          return
        }

        await copyText(composePrompt(pickedInfo, prompt))
        showToast('herdr unreachable, prompt copied to clipboard', true)
        close()
      } catch {
        await copyText(composePrompt(pickedInfo, prompt))
        showToast('herdr unreachable, prompt copied to clipboard', true)
        close()
      }
    }

    // --- open-in-editor -----------------------------------------------------

    editorBtn.addEventListener('click', () => {
      if (editorMatch === null) return
      void fetch(`${base}__open-in-editor?file=${encodeURIComponent(editorMatch)}`)
    })

    // --- window listeners (capture phase) -----------------------------------

    window.addEventListener(
      'keydown',
      (e) => {
        if (mode === 'idle') {
          if (matchesHotkey(e, hotkey)) {
            e.preventDefault()
            e.stopPropagation()
            enterPicking()
          }
          return
        }

        if (mode === 'picking') {
          if (e.key === 'Escape' || matchesHotkey(e, hotkey)) {
            e.preventDefault()
            e.stopPropagation()
            exitPicking()
          }
          return
        }

        // popup or sending
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
          return
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          e.stopPropagation()
          if (mode === 'popup') void send()
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          moveSelection(-1)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          moveSelection(1)
          return
        }
        e.stopPropagation()
      },
      true,
    )

    window.addEventListener(
      'pointermove',
      (e) => {
        if (mode !== 'picking') return
        lastPointerX = e.clientX
        lastPointerY = e.clientY
        updateHover(e.clientX, e.clientY)
      },
      true,
    )

    function refreshHover(): void {
      if (mode !== 'picking') return
      // the hovered element may not have moved, but its rect likely did
      hoveredEl = null
      updateHover(lastPointerX, lastPointerY)
    }

    function onScrollOrResize(): void {
      refreshHover()
      positionInflight()
    }

    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize, true)

    function blockInPicking(e: Event): void {
      if (mode !== 'picking') return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('pointerdown', blockInPicking, true)
    window.addEventListener('mousedown', blockInPicking, true)
    window.addEventListener('mouseup', blockInPicking, true)

    window.addEventListener(
      'click',
      (e) => {
        if (mode !== 'picking') return
        e.preventDefault()
        e.stopPropagation()
        const el = deepElementFromPoint(e.clientX, e.clientY, host)
        if (el === null) return
        pick(el, e.clientX, e.clientY)
      },
      true,
    )

    // --- public debug/bench API -----------------------------------------------------

    window.__herdr = {
      version: 'dev',
      describe: (el) => describeElement(el, { maxDepth: options.maxDepth, maxLines: options.maxLines }),
      outline: (el) => {
        if (el === null) {
          clearOutline()
          return
        }
        drawOutlineAt(el)
      },
      pick: (el, x, y) => pick(el, x, y),
      close: () => close(),
      inflight: () => inflightPaneId,
    }
  }

  if (document.body !== null) mount()
  else document.addEventListener('DOMContentLoaded', () => mount(), { once: true })
}

if (typeof document !== 'undefined' && window.__herdr === undefined) {
  boot()
}
