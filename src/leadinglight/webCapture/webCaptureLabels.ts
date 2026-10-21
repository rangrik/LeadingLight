// Every string the website dialog shows, injected by the host from its locale. The dialog itself
// holds no copy. Proposed keys and English are in docs/leadinglight/web-capture-experience.md.
import type { SavedCopy } from './webCaptureDuplicates'
import type { WebCaptureFailure } from './webCaptureFlow'

export type WebCaptureUncertainDetail = 'noReply' | 'running' | 'unknown'

export interface WebCaptureLabels {
  readonly description: string
  readonly addressLabel: string
  readonly addressPlaceholder: string
  readonly fetch: string
  readonly fetchAnyway: string
  readonly stop: string
  readonly willFetch: (url: string) => string
  readonly fetching: (host: string) => string
  readonly preparing: string
  readonly stopped: string
  readonly pageReady: (title: string) => string
  readonly failure: Readonly<Record<WebCaptureFailure, string>>
  readonly saveLinkOnly: string
  readonly openInBrowser: string
  readonly wasAddress: (url: string) => string
  readonly savedBefore: (copy: SavedCopy) => string
  readonly savedBeforeIncomplete: string
  readonly openSavedCopy: string
  readonly saveAnotherCopy: string
  readonly pageTitle: string
  readonly titleProblem: string
  readonly createIn: string
  readonly rootFolder: string
  readonly willCreate: (path: string) => string
  readonly exists: (fileName: string, folder: string) => string
  readonly imagesAsLinks: string
  readonly linkOnlyNotice: string
  readonly showPreview: string
  readonly hidePreview: string
  readonly previewLabel: string
  readonly previewPreparing: string
  readonly save: string
  readonly saving: string
  readonly cancel: string
  readonly done: string
  readonly close: string
  readonly checkAgain: string
  readonly checking: string
  readonly uncertain: (detail: WebCaptureUncertainDetail) => string
  readonly uncertainWhere: (path: string) => string
  readonly created: (path: string) => string
  readonly createdNotOpened: (path: string) => string
  readonly createdElsewhere: (path: string) => string
  readonly notDurable: string
  readonly revoked: (reason: 'workspace' | 'package') => string
  /** A reason the host's controller, or the note preparation, proved nothing was written. */
  readonly notWritten: (reason: string) => string
  readonly formProblem: string
  readonly discardQuestion: string
  readonly discardHint: string
  readonly discardUncertain: string
  readonly keepEditing: string
  readonly discard: string
  readonly stopChecking: string
}
