// The two places a website command's recipe meets the host's page, built only from the frozen
// domain seam (extensionRecipe `previewDocument`, extensionWebPage `webArticleComposition`,
// extensionMarkdown `packageBlocksMarkdown`): the dialog's live composition, and the host's
// synchronous answer for the one proposal. Neither fetches, converts or writes.
import type { ComposedDocument, ExtensionCommand, FormAnswers, InputProblem, WebPageCapture } from '../extensions/extensionContract'
import { packageBlocksMarkdown } from '../extensions/extensionMarkdown'
import { previewDocument } from '../extensions/extensionRecipe'
import { webArticleComposition } from '../extensions/extensionWebPage'
import { matchPreparedNote, type PreparedWebCaptureNote } from './webCaptureNote'

// Stands in for the folder the person picks; previews never reach native with it.
const CHECK_HANDLE = 'web-capture-check'

export type WebCaptureComposition =
  | { readonly status: 'ready'; readonly title: string; readonly packageParts: readonly string[] }
  | { readonly status: 'invalid'; readonly problems: readonly InputProblem[] }

/** The recipe's title and own blocks (as the host's literal encoder writes them) for this page. */
export function composeWebCaptureNote(command: ExtensionCommand, answers: FormAnswers, webPage: WebPageCapture): WebCaptureComposition {
  const preview = previewDocument(command, { capture: null, answers, destination: { kind: 'newInFolder', folderHandle: CHECK_HANDLE }, webPage })
  const composition = preview.document ? webArticleComposition(preview.document) : null
  if (preview.problems.length > 0 || !composition) return { status: 'invalid', problems: preview.problems }
  return { status: 'ready', title: composition.title, packageParts: packageBlocksMarkdown(composition.blocks) }
}

/**
 * The bytes for the one proposal of a website run: the verified note when the proposal's document is
 * exactly the page (by its handle), title and package blocks that were verified, under the file name
 * the host chose. Anything else, including another run's or a revoked handle, writes nothing.
 */
export function webCaptureContentFor(
  document: ComposedDocument,
  expected: { readonly page: string; readonly fileName: string; readonly prepared: PreparedWebCaptureNote },
): { readonly status: 'ready'; readonly content: string } | { readonly status: 'refused'; readonly reason: 'internal' } {
  const composition = webArticleComposition(document)
  if (!composition || composition.page !== expected.page) return { status: 'refused', reason: 'internal' }
  return matchPreparedNote(expected.prepared, {
    title: composition.title, packageParts: packageBlocksMarkdown(composition.blocks), fileName: expected.fileName,
  })
}
