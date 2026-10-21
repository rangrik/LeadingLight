// The host's own words about Adapt: provider status, phases, outcomes and notices. Model prose is
// never passed through these; it is shown beside them as plain text.
import type { TranslationKey } from '../../lib/i18n'
import type { T } from '../extensions/extensionUiText'
import type { AdaptEntry, AdaptProviderState, AdaptSendRefusal, AdaptTurnPhase } from './adaptContract'
import type { AdaptNotice } from './adaptController'

const PHASE_KEYS: Record<AdaptTurnPhase, TranslationKey> = {
  sending: 'leadinglight.adapt.phase.sending',
  working: 'leadinglight.adapt.phase.working',
  checking: 'leadinglight.adapt.phase.checking',
  stopping: 'leadinglight.adapt.phase.stopping',
}
export const phaseText = (t: T, phase: AdaptTurnPhase) => t(PHASE_KEYS[phase])

const UNAVAILABLE_KEYS: Record<Extract<AdaptProviderState, { status: 'unavailable' }>['reason'], TranslationKey> = {
  notInstalled: 'leadinglight.adapt.unavailable.notInstalled',
  unsupportedVersion: 'leadinglight.adapt.unavailable.unsupportedVersion',
  unqualified: 'leadinglight.adapt.unavailable.unqualified',
  notAuthorized: 'leadinglight.adapt.unavailable.notAuthorized',
  failed: 'leadinglight.adapt.unavailable.failed',
  storageUnavailable: 'leadinglight.adapt.unavailable.storageUnavailable',
}

/** Why Codex cannot be used, from the host's status only; a version is named only when the host found one. */
export function unavailableText(t: T, state: Extract<AdaptProviderState, { status: 'unavailable' }>): string {
  if (state.reason === 'unsupportedVersion' && state.installedVersion) return t('leadinglight.adapt.unavailable.unsupportedVersionFound', { version: state.installedVersion })
  return t(UNAVAILABLE_KEYS[state.reason])
}

type Failed = Extract<AdaptEntry, { kind: 'failed' }>
const FAILED_KEYS: Record<Failed['reason'], TranslationKey> = {
  providerFailed: 'leadinglight.adapt.failed.providerFailed',
  invalidOutput: 'leadinglight.adapt.failed.invalidOutput',
  outputTooLarge: 'leadinglight.adapt.failed.outputTooLarge',
  usageLimit: 'leadinglight.adapt.failed.usageLimit',
  notConnected: 'leadinglight.adapt.failed.notConnected',
  toolRefused: 'leadinglight.adapt.failed.toolRefused',
  timedOut: 'leadinglight.adapt.failed.timedOut',
}

/** A reset time is shown only when the provider gave one. */
export function failedText(t: T, entry: Failed, formatTime: (iso: string) => string): string {
  if (entry.reason === 'usageLimit' && entry.resetsAt) return t('leadinglight.adapt.failed.usageLimitUntil', { time: formatTime(entry.resetsAt) })
  return t(FAILED_KEYS[entry.reason])
}

type Stopped = Extract<AdaptEntry, { kind: 'stopped' }>
const STOPPED_KEYS: Record<Stopped['reason'], TranslationKey> = {
  cancelled: 'leadinglight.adapt.stopped',
  visitClosed: 'leadinglight.adapt.stoppedBy.visitClosed',
  accountChanged: 'leadinglight.adapt.stoppedBy.accountChanged',
  appClosed: 'leadinglight.adapt.stoppedBy.appClosed',
}
/** "Stopped" only when native proved the turn ended; otherwise that the stop is unconfirmed. */
export const stoppedText = (t: T, entry: Stopped) => t(entry.confirmed ? STOPPED_KEYS[entry.reason] : 'leadinglight.adapt.stopUnconfirmed')

const SEND_KEYS: Partial<Record<AdaptSendRefusal | 'notSent', TranslationKey>> = {
  notSent: 'leadinglight.adapt.sendRefused.notSent',
  cancelled: 'leadinglight.adapt.sendRefused.cancelled',
  busy: 'leadinglight.adapt.sendRefused.busy',
  notConnected: 'leadinglight.adapt.sendRefused.notConnected',
  providerUnavailable: 'leadinglight.adapt.sendRefused.providerUnavailable',
  tooLarge: 'leadinglight.adapt.sendRefused.tooLarge',
  invalidRequest: 'leadinglight.adapt.sendRefused.invalidRequest',
  conversationFull: 'leadinglight.adapt.sendRefused.conversationFull',
}

const ATTACH_KEYS: Record<Extract<AdaptNotice, { kind: 'attachRefused' }>['reason'], TranslationKey> = {
  empty: 'leadinglight.adapt.attachRefused.empty',
  tooLarge: 'leadinglight.adapt.attachRefused.tooLarge',
  tooMany: 'leadinglight.adapt.attachRefused.tooMany',
  totalTooLarge: 'leadinglight.adapt.attachRefused.totalTooLarge',
  unsafeText: 'leadinglight.adapt.attachRefused.unsafeText',
  noPage: 'leadinglight.adapt.attachRefused.noPage',
  notSaved: 'leadinglight.adapt.attachRefused.notSaved',
  pageChanged: 'leadinglight.adapt.attachRefused.pageChanged',
}

export function noticeText(t: T, notice: AdaptNotice): string {
  switch (notice.kind) {
    case 'sendRefused': return t(SEND_KEYS[notice.reason] ?? 'leadinglight.adapt.sendRefused.other')
    case 'conversationRefused':
      return t(notice.reason === 'conversationLimit' ? 'leadinglight.adapt.conversationRefused.conversationLimit' : 'leadinglight.adapt.conversationRefused.other')
    case 'deleteRefused': return t(notice.reason === 'running' ? 'leadinglight.adapt.deleteRefused.running' : 'leadinglight.adapt.deleteRefused.other')
    case 'connectRefused':
      return t(notice.reason === 'browserUnavailable' ? 'leadinglight.adapt.connectRefused.browserUnavailable' : 'leadinglight.adapt.connectRefused.other')
    case 'attachRefused': return t(ATTACH_KEYS[notice.reason])
    case 'cancelConnectUnconfirmed':
      return t(notice.reason === 'unconfirmed' ? 'leadinglight.adapt.cancelConnectUnconfirmed' : 'leadinglight.adapt.cancelConnectNoReply')
    case 'cancelUnconfirmed': return t('leadinglight.adapt.stopUnconfirmed')
    case 'visitClosed': return t('leadinglight.adapt.visitClosed')
    case 'disconnectRefused': return t('leadinglight.adapt.disconnectRefused')
    case 'saveRefused': return t('leadinglight.adapt.saveRefused')
  }
}

/** A byte count as the chips show it. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
