import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerReadyPage, type HandOver } from '../hooks/useEditorFocus'
import { CaptureHeldError, PendingCaptureController, type CaptureOutcome } from './pendingCapture'

const PATH = '/vault/untitled-page-1.md'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const registrations: (() => void)[] = []
const delivered = (text: string, focused = true): HandOver =>
  ({ kind: 'delivered', receipt: { path: PATH, content: `# Page\n\n${text}`, session: 1, seq: 4 }, focused })

function setup() {
  const mark = { pane: 0, current: vi.fn(() => true) }
  const capture = new PendingCaptureController()
  capture.configure({ markNavigation: () => mark, openPage: vi.fn(async () => true) })
  const root = document.body.appendChild(document.createElement('div'))
  root.dataset.pendingCapture = 'true'
  const field = root.appendChild(document.createElement('textarea'))
  capture.attachField(field)
  const type = (text: string) => { field.value = text; capture.input(text) }
  const accept = vi.fn<(text: string) => HandOver>(text => delivered(text))
  const ready = (pane = '0') => {
    const unregister = registerReadyPage(PATH, { pane: () => pane, focus: () => true, accept })
    registrations.push(unregister)
    return unregister
  }
  return { capture, mark, field, type, accept, ready }
}

afterEach(() => {
  registrations.splice(0).forEach(unregister => unregister())
  document.body.innerHTML = ''
})

describe('pending page draft', () => {
  it('takes the keyboard at once and hands the whole draft over once, to the shown page in its own pane', async () => {
    const { capture, field, type, accept, ready } = setup()
    const outcome = capture.admit('newPage', vi.fn())
    expect(document.activeElement).toBe(field)
    type('line one\nline two')
    outcome.shown(PATH)
    const unregister = ready('1')
    await tick()
    expect(accept).not.toHaveBeenCalled()
    unregister()
    ready()
    await tick()
    expect(accept).toHaveBeenCalledExactlyOnceWith('line one\nline two')
    expect(capture.getView()).toBeNull()
    expect(capture.deliveredTargets()).toEqual([{ path: PATH, session: 1, seq: 4 }])
  })

  it('keeps every word and never hands over after the person navigated, even when the same page shows up later', async () => {
    const { capture, mark, type, accept, ready } = setup()
    const outcome = capture.admit('newPage', vi.fn())
    type('kept words')
    mark.current.mockReturnValue(false)
    capture.checkOwnership()
    outcome.created(PATH)
    ready()
    await tick()
    expect(accept).not.toHaveBeenCalled()
    expect(capture.getView()).toMatchObject({ phase: 'kept', openable: true })
  })

  it('keeps the draft after a failed create; Try again starts a fresh attempt and ignores the old one', async () => {
    const { capture, type, accept, ready } = setup()
    const attempts: CaptureOutcome[] = []
    attempts.push(capture.admit('newPage', () => { attempts.push(capture.rebind()) }))
    type('draft')
    attempts[0].failed()
    expect(capture.getView()).toMatchObject({ phase: 'failed' })
    capture.retry()
    attempts[0].shown(PATH)
    ready()
    await tick()
    expect(accept).not.toHaveBeenCalled()
    attempts[1].shown(PATH)
    expect(accept).toHaveBeenCalledExactlyOnceWith('draft')
  })

  it('joins the same pending command, refuses to move a written draft to another command, and replaces an empty one', () => {
    const { capture, type } = setup()
    capture.admit('newPage', vi.fn())
    const token = capture.getView()?.token
    expect(capture.claim('newPage')).toBe(true)
    type('mine')
    expect(capture.claim('today')).toBe(true)
    expect(capture.getView()).toMatchObject({ token, finishFirst: true })
    type('')
    expect(capture.claim('today')).toBe(false)
    expect(capture.getView()).toBeNull()
  })

  it.each([['compositionend before the final input', true], ['the final input before compositionend', false]])(
    'waits for a composition to settle when %s', async (_name, endFirst) => {
      const { capture, type, accept, ready } = setup()
      capture.admit('today', vi.fn()).shown(PATH)
      ready()
      capture.compositionStart()
      type('港')
      await tick()
      expect(accept).not.toHaveBeenCalled()
      if (endFirst) capture.compositionEnd()
      type('港口')
      if (!endFirst) capture.compositionEnd()
      await tick()
      expect(accept).toHaveBeenCalledExactlyOnceWith('港口')
    })

  // Seam: nothing inserted may be tried again; anything maybe inserted stays a visible copy and is never replayed.
  it('retries a draft the page could not yet take, and never replays one that may be in the page', async () => {
    const { capture, field, type, accept, ready } = setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    accept.mockReturnValueOnce({ kind: 'notReady' }).mockReturnValueOnce({ kind: 'uncertain' })
    const outcome = capture.admit('newPage', vi.fn())
    type('draft')
    ready()
    outcome.shown(PATH)
    expect(capture.getView()).toMatchObject({ phase: 'opening' })
    expect(document.activeElement).toBe(field)

    capture.pump()
    await tick()
    expect(capture.getView()).toMatchObject({ phase: 'partial', openable: false })
    capture.pump()
    capture.retry()
    capture.openPage()
    expect(capture.claim('newPage')).toBe(true)
    await tick()
    expect(accept).toHaveBeenCalledTimes(2)
  })

  it('keeps a copy, without replay, when the text is in the page but the page did not keep the keyboard', () => {
    const { capture, type, accept, ready } = setup()
    accept.mockReturnValueOnce(delivered('draft', false))
    const outcome = capture.admit('newPage', vi.fn())
    type('draft')
    ready()
    outcome.shown(PATH)
    expect(capture.getView()).toMatchObject({ phase: 'partial' })
    expect(capture.deliveredTargets()).toHaveLength(1)
  })

  describe('quit and vault switch', () => {
    it('refuse at once while the draft holds words or an open composition, and leave the field as it was', () => {
      const { capture, field, type } = setup()
      capture.admit('newPage', vi.fn())
      type('港')
      capture.compositionStart()
      expect(() => capture.beginBoundary()).toThrow(CaptureHeldError)
      expect(document.activeElement).toBe(field)
      expect(field.value).toBe('港')
      capture.compositionEnd()
      expect(() => capture.beginBoundary()).toThrow(CaptureHeldError)
    })

    // Seam: a draft replaced during a switch must never ride along unaccounted.
    it('drop an empty draft and admit no new one until released; a draft present at the end refuses', () => {
      const { capture } = setup()
      capture.admit('newPage', vi.fn())
      const release = capture.beginBoundary()
      expect(capture.getView()).toBeNull()
      expect(capture.accepting()).toBe(false)
      expect(() => capture.assertClear()).not.toThrow()
      release()
      expect(capture.accepting()).toBe(true)

      const late = capture.beginBoundary()
      late()
      capture.admit('today', vi.fn())
      expect(() => capture.assertClear()).toThrow(CaptureHeldError)
    })

    // Seam: the field is gone after a normal hand-over; its page must still be on disk before Save, quit or switch succeeds.
    it('keep a delivered page until the save queue proves it written, through held and failed drains', async () => {
      const { capture, type, ready } = setup()
      const outcome = capture.admit('newPage', vi.fn())
      type('words')
      ready()
      outcome.shown(PATH)
      expect(capture.getView()).toBeNull()
      const status = vi.fn(() => 'pending' as const)
      const save = vi.fn(async () => false)
      expect(await capture.settleDelivered({ status, save })).toBe(false)
      save.mockRejectedValueOnce(new Error('disk full'))
      expect(await capture.settleDelivered({ status, save })).toBe(false)
      expect(save).toHaveBeenCalledWith(PATH)
      expect(capture.deliveredTargets()).toHaveLength(1)

      const proved = vi.fn<(target: unknown) => 'pending' | 'settled' | 'unproven'>(() => 'unproven')
      expect(await capture.settleDelivered({ status: proved, save })).toBe(false)
      proved.mockReturnValue('settled')
      expect(await capture.settleDelivered({ status: proved, save })).toBe(true)
      expect(capture.deliveredTargets()).toEqual([])
    })
  })
})
