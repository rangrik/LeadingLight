// The website dialog's words from the app's locale: `leadinglight.webCapture.*` for what is new, and
// the extension run dialog's own keys for what is shared (docs/leadinglight/web-capture-experience.md).
import type { TranslationKey } from '../../lib/i18n'
import type { NotWrittenReason } from '../extensions/extensionSessionController'
import { notWrittenText, type T } from '../extensions/extensionUiText'
import type { WebCaptureFailure } from './webCaptureFlow'
import type { WebCaptureLabels, WebCaptureUncertainDetail } from './webCaptureLabels'
import type { WebCaptureMediaLabels } from './webCapturePipeline'

const FAILURE_KEYS: Record<WebCaptureFailure, TranslationKey> = {
  unusableAddress: 'leadinglight.webCapture.failure.unusableAddress',
  refusedAddress: 'leadinglight.webCapture.failure.refusedAddress',
  redirectRefused: 'leadinglight.webCapture.failure.redirectRefused',
  notFound: 'leadinglight.webCapture.failure.notFound',
  accessDenied: 'leadinglight.webCapture.failure.accessDenied',
  unreadable: 'leadinglight.webCapture.failure.unreadable',
  notHtml: 'leadinglight.webCapture.failure.notHtml',
  unsupportedPage: 'leadinglight.webCapture.failure.unsupportedPage',
  tooLargeOrComplex: 'leadinglight.webCapture.failure.tooLargeOrComplex',
  rateLimited: 'leadinglight.webCapture.failure.rateLimited',
  unreachable: 'leadinglight.webCapture.failure.unreachable',
  tlsFailed: 'leadinglight.webCapture.failure.tlsFailed',
  unavailable: 'leadinglight.webCapture.failure.unavailable',
}

const UNCERTAIN_KEYS: Record<WebCaptureUncertainDetail, TranslationKey> = {
  noReply: 'leadinglight.extensions.uncertain',
  running: 'leadinglight.extensions.uncertainRunning',
  unknown: 'leadinglight.extensions.uncertainUnknown',
}

const NOT_WRITTEN = new Set<string>([
  'storage', 'invalidName', 'tooLarge', 'link', 'folderMissing', 'busy', 'notStarted', 'unavailable', 'unsafeText', 'internal', 'changed', 'unsafeTail', 'notAssociated',
] satisfies readonly Exclude<NotWrittenReason, 'exists'>[])
const isNotWrittenReason = (reason: string): reason is Exclude<NotWrittenReason, 'exists'> => NOT_WRITTEN.has(reason)

/** The words for media links in a saved note. */
export function webCaptureMediaLabels(t: T): WebCaptureMediaLabels {
  return {
    image: t('leadinglight.webCapture.media.image'),
    video: t('leadinglight.webCapture.media.video'),
    audio: t('leadinglight.webCapture.media.audio'),
  }
}

/** `folderOf`: the folder a saved copy is in, as the person reads it. */
export function webCaptureLabels(t: T, folderOf: (path: string) => string): WebCaptureLabels {
  return {
    description: t('leadinglight.webCapture.description'),
    addressLabel: t('leadinglight.webCapture.address'),
    addressPlaceholder: t('leadinglight.webCapture.addressPlaceholder'),
    fetch: t('leadinglight.webCapture.fetch'),
    fetchAnyway: t('leadinglight.webCapture.fetchAnyway'),
    stop: t('leadinglight.webCapture.stop'),
    willFetch: url => t('leadinglight.webCapture.willFetch', { url }),
    fetching: host => t('leadinglight.webCapture.fetching', { host }),
    preparing: t('leadinglight.webCapture.preparing'),
    stopped: t('leadinglight.webCapture.stopped'),
    pageReady: title => t('leadinglight.webCapture.pageReady', { title }),
    failure: Object.fromEntries(Object.entries(FAILURE_KEYS).map(([failure, key]) => [failure, t(key)])) as Record<WebCaptureFailure, string>,
    saveLinkOnly: t('leadinglight.webCapture.saveLinkOnly'),
    openInBrowser: t('leadinglight.webCapture.openInBrowser'),
    wasAddress: url => t('leadinglight.webCapture.wasAddress', { url }),
    savedBefore: copy => t('leadinglight.webCapture.savedBefore', { title: copy.title, folder: folderOf(copy.path) }),
    savedBeforeIncomplete: t('leadinglight.webCapture.savedBeforeIncomplete'),
    openSavedCopy: t('leadinglight.webCapture.openSavedCopy'),
    saveAnotherCopy: t('leadinglight.webCapture.saveAnotherCopy'),
    pageTitle: t('leadinglight.webCapture.title'),
    titleProblem: t('leadinglight.webCapture.titleProblem'),
    createIn: t('leadinglight.extensions.createIn'),
    rootFolder: t('leadinglight.extensions.rootFolder'),
    willCreate: path => t('leadinglight.extensions.willCreate', { path }),
    exists: (name, folder) => t('leadinglight.webCapture.exists', { name, folder }),
    imagesAsLinks: t('leadinglight.webCapture.imagesAsLinks'),
    linkOnlyNotice: t('leadinglight.webCapture.linkOnlyNotice'),
    showPreview: t('leadinglight.extensions.showPreview'),
    hidePreview: t('leadinglight.extensions.hidePreview'),
    previewLabel: t('leadinglight.extensions.previewLabel'),
    previewPreparing: t('leadinglight.webCapture.previewPreparing'),
    save: t('leadinglight.webCapture.save'),
    saving: t('leadinglight.webCapture.saving'),
    cancel: t('leadinglight.extensions.cancel'),
    done: t('leadinglight.extensions.done'),
    close: t('leadinglight.extensions.close'),
    checkAgain: t('leadinglight.extensions.checkAgain'),
    checking: t('leadinglight.extensions.checking'),
    uncertain: detail => t(UNCERTAIN_KEYS[detail]),
    uncertainWhere: path => t('leadinglight.extensions.uncertainWhere', { path }),
    created: path => t('leadinglight.extensions.created', { path }),
    createdNotOpened: path => t('leadinglight.extensions.createdNotOpened', { path }),
    createdElsewhere: path => t('leadinglight.extensions.createdElsewhere', { path }),
    notDurable: t('leadinglight.extensions.notDurable'),
    revoked: reason => t(reason === 'workspace' ? 'leadinglight.extensions.revokedWorkspace' : 'leadinglight.extensions.revokedPackage'),
    // A reason this host does not know is said as the general one; it still proves nothing was written.
    notWritten: reason => notWrittenText(t, isNotWrittenReason(reason) ? reason : 'unavailable'),
    formProblem: t('leadinglight.extensions.problem.form'),
    discardQuestion: t('leadinglight.extensions.discardQuestion'),
    discardHint: t('leadinglight.extensions.discardHint'),
    discardUncertain: t('leadinglight.extensions.discardUncertain'),
    keepEditing: t('leadinglight.extensions.keepEditing'),
    discard: t('leadinglight.extensions.discard'),
    stopChecking: t('leadinglight.extensions.stopChecking'),
  }
}
