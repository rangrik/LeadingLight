import { afterEach, describe, expect, it, vi } from 'vitest'
import { WEB_CAPTURE_COMMANDS, createWebCaptureTransport, readCancelReply, readFetchReply, type WebCaptureAsk } from './webCaptureTransport'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const FETCHED = {
  status: 'fetched', attemptId: ID, requestedUrl: 'https://e.org/a', finalUrl: 'https://e.org/b', fetchedAt: '2026-10-20T14:03:11Z',
  contentType: 'text/html', encoding: 'UTF-8', encodingSource: 'header', html: '<p>x</p>', hadReplacements: false,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reading native replies', () => {
  it('accepts exactly W1\'s three fetch replies for this attempt', () => {
    expect(readFetchReply(FETCHED, ID)).toEqual(FETCHED)
    expect(readFetchReply({ status: 'failed', attemptId: ID, reason: 'notPublicAddress' }, ID)).toEqual({ status: 'failed', attemptId: ID, reason: 'notPublicAddress' })
    expect(readFetchReply({ status: 'cancelled', attemptId: ID }, ID)).toEqual({ status: 'cancelled', attemptId: ID })
  })

  it.each([
    ['another attempt', { ...FETCHED, attemptId: 'a-different-id' }],
    ['an extra field', { ...FETCHED, serverMessage: 'hello' }],
    ['a missing field', { ...FETCHED, html: undefined }],
    ['an unknown reason', { status: 'failed', attemptId: ID, reason: 'serverSaid: go away' }],
    ['a reason with text', { status: 'failed', attemptId: ID, reason: 'notFound', detail: '404 page' }],
    ['a content type outside the list', { ...FETCHED, contentType: 'application/pdf' }],
    ['a local time', { ...FETCHED, fetchedAt: '2026-10-20T14:03:11+02:00' }],
    ['an unknown status', { status: 'done', attemptId: ID }],
    ['html over 5 MiB', { ...FETCHED, html: 'x'.repeat(5 * 1024 * 1024 + 1) }],
    ['a string', 'fetched'],
    ['null', null],
  ])('treats %s as no reply', (_name, value) => {
    expect(readFetchReply(value, ID)).toBeNull()
  })

  it('reads cancel replies for this attempt only', () => {
    expect(readCancelReply({ status: 'cancelled', attemptId: ID }, ID)).toEqual({ status: 'cancelled', attemptId: ID })
    expect(readCancelReply({ status: 'notActive', attemptId: ID }, ID)).toEqual({ status: 'notActive', attemptId: ID })
    expect(readCancelReply({ status: 'notActive', attemptId: 'other' }, ID)).toBeNull()
    expect(readCancelReply({ status: 'stopped', attemptId: ID }, ID)).toBeNull()
  })
})

describe('the transport', () => {
  it('sends only the two declared commands, each with one args object', async () => {
    const ask = vi.fn<WebCaptureAsk>(async (command) => (command === WEB_CAPTURE_COMMANDS.fetch ? FETCHED : { status: 'cancelled', attemptId: ID }))
    const transport = createWebCaptureTransport(ask)
    expect(await transport.fetch(ID, 'https://e.org/a')).toEqual(FETCHED)
    expect(await transport.cancel(ID)).toEqual({ status: 'cancelled', attemptId: ID })
    expect(ask.mock.calls).toEqual([
      ['web_capture_fetch', { args: { attemptId: ID, url: 'https://e.org/a' } }],
      ['web_capture_cancel', { args: { attemptId: ID } }],
    ])
  })

  it('answers unavailable, without logging the address, when native is missing, rejects or answers oddly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const secret = 'https://e.org/private?token=s3cret'
    expect(await createWebCaptureTransport(async () => { throw new Error(`No mock handler for ${secret}`) }).fetch(ID, secret)).toEqual({ status: 'unavailable' })
    expect(await createWebCaptureTransport(async () => ({ status: 'fetched' })).fetch(ID, secret)).toEqual({ status: 'unavailable' })
    expect(await createWebCaptureTransport(async () => undefined).cancel(ID)).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret')
  })

  it('in the browser build (no native app, no mock handler) is honestly unavailable and contacts nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await createWebCaptureTransport().fetch(ID, 'https://e.org/a')).toEqual({ status: 'unavailable' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})
