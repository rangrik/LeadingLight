// The dialog's only route to the native page fetch (W1, `web-capture-native-contract.md`). Two
// declared commands, one strict `args` object each; nothing here takes a command name, header or
// option from a caller. Every reply is read strictly against the request's own attempt id: a
// rejected call, a missing command (the browser build has none) or an unexpected shape is
// `unavailable`, which is never read as a page.
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import { utf8Length } from './articleText'
import {
  WEB_CAPTURE_CONTENT_TYPES, WEB_CAPTURE_ENCODING_SOURCES, WEB_CAPTURE_FAILURE_REASONS, WEB_CAPTURE_LIMITS,
  type WebCaptureCancelReply, type WebCaptureFetchReply,
} from './webCaptureContract'

/** W1's suggested command names; W3's native integration contract is the final word. */
export const WEB_CAPTURE_COMMANDS = { fetch: 'web_capture_fetch', cancel: 'web_capture_cancel' } as const
export type WebCaptureCommand = (typeof WEB_CAPTURE_COMMANDS)[keyof typeof WEB_CAPTURE_COMMANDS]

/** Sends one declared command with its arguments and resolves to the raw answer. */
export type WebCaptureAsk = (command: WebCaptureCommand, args: Record<string, unknown>) => Promise<unknown>

export type WebCaptureFetchOutcome = WebCaptureFetchReply | { readonly status: 'unavailable' }
export type WebCaptureCancelOutcome = WebCaptureCancelReply | { readonly status: 'unavailable' }

export interface WebCaptureTransport {
  fetch(attemptId: string, url: string): Promise<WebCaptureFetchOutcome>
  cancel(attemptId: string): Promise<WebCaptureCancelOutcome>
}

const UNAVAILABLE = Object.freeze({ status: 'unavailable' } as const)
const RFC3339_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
const ENCODING_NAME = /^[A-Za-z0-9._:-]{1,40}$/u

const nativeAsk: WebCaptureAsk = (command, args) => (isTauri() ? invoke(command, args) : mockInvoke(command, args))

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'

function hasExactKeys(value: Fields, keys: readonly string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value)
}

const FETCHED_KEYS = ['status', 'attemptId', 'requestedUrl', 'finalUrl', 'fetchedAt', 'contentType', 'encoding', 'encodingSource', 'html', 'hadReplacements']

function readFetched(value: Fields): WebCaptureFetchReply | null {
  if (!hasExactKeys(value, FETCHED_KEYS)) return null
  const { requestedUrl, finalUrl, fetchedAt, contentType, encoding, encodingSource, html, hadReplacements } = value
  if (!isString(requestedUrl) || !isString(finalUrl) || !isString(fetchedAt) || !RFC3339_UTC_SECONDS.test(fetchedAt)) return null
  if (!oneOf(WEB_CAPTURE_CONTENT_TYPES, contentType) || !isString(encoding) || !ENCODING_NAME.test(encoding)) return null
  if (!oneOf(WEB_CAPTURE_ENCODING_SOURCES, encodingSource) || typeof hadReplacements !== 'boolean') return null
  if (!isString(html) || utf8Length(html) > WEB_CAPTURE_LIMITS.htmlBytes) return null
  return Object.freeze({
    status: 'fetched', attemptId: value.attemptId as string, requestedUrl, finalUrl, fetchedAt, contentType, encoding, encodingSource, html, hadReplacements,
  })
}

/** W1's fetch reply for this attempt, or `null` for anything else. */
export function readFetchReply(value: unknown, attemptId: string): WebCaptureFetchReply | null {
  if (!isFields(value) || value.attemptId !== attemptId) return null
  switch (value.status) {
    case 'fetched':
      return readFetched(value)
    case 'failed':
      return hasExactKeys(value, ['status', 'attemptId', 'reason']) && oneOf(WEB_CAPTURE_FAILURE_REASONS, value.reason)
        ? Object.freeze({ status: 'failed', attemptId, reason: value.reason })
        : null
    case 'cancelled':
      return hasExactKeys(value, ['status', 'attemptId']) ? Object.freeze({ status: 'cancelled', attemptId }) : null
    default:
      return null
  }
}

/** W1's cancel reply for this attempt, or `null` for anything else. */
export function readCancelReply(value: unknown, attemptId: string): WebCaptureCancelReply | null {
  if (!isFields(value) || value.attemptId !== attemptId || !hasExactKeys(value, ['status', 'attemptId'])) return null
  if (value.status === 'cancelled' || value.status === 'notActive') return Object.freeze({ status: value.status, attemptId })
  return null
}

export function createWebCaptureTransport(ask: WebCaptureAsk = nativeAsk): WebCaptureTransport {
  async function send<T>(command: WebCaptureCommand, args: Record<string, unknown>, read: (value: unknown) => T | null): Promise<T | typeof UNAVAILABLE> {
    let reply: unknown
    try {
      reply = await ask(command, { args })
    } catch {
      // Logged without the address: an address can carry a token.
      console.warn(`[webCapture] ${command} did not answer`)
      return UNAVAILABLE
    }
    const parsed = read(reply)
    if (parsed === null) console.warn(`[webCapture] ${command} answered in an unexpected shape`)
    return parsed ?? UNAVAILABLE
  }
  return {
    fetch: (attemptId, url) => send(WEB_CAPTURE_COMMANDS.fetch, { attemptId, url }, value => readFetchReply(value, attemptId)),
    cancel: attemptId => send(WEB_CAPTURE_COMMANDS.cancel, { attemptId }, value => readCancelReply(value, attemptId)),
  }
}
