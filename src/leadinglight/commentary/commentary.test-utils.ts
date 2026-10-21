// Synthetic captures and recipe output for commentary tests, through the real bundled recipe and the
// real E1 composer. No vault, no native call.
import type { ComposedDocument, ExtensionCommand, FormAnswers } from '../extensions/extensionContract'
import passageCommentary from '../extensions/fixtures/passage-commentary.json?raw'
import { previewDocument } from '../extensions/extensionRecipe'
import { parseExtensionPackage } from '../extensions/extensionSchema'
import type { CapturedPassage } from './commentaryContract'
import { sourceBodyOf } from './commentaryFormat'
import { projectMarkdownBody } from './passageProjection'
import { selectorAt, unanchoredSelector } from './passageSelector'

export const SOURCE_SHA = 'a'.repeat(64)
export const BASELINE_SHA = 'b'.repeat(64)

/** Deterministic lowercase UUID v4 values. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export function commentaryCommand(): ExtensionCommand {
  const parsed = parseExtensionPackage(passageCommentary)
  if (parsed.status !== 'valid') throw new Error('passage-commentary fixture is invalid')
  return parsed.extension.commands[0]
}

/** A capture of `exact`, anchored at its first occurrence in the source's projection when present. */
export function captureOf(sourceContent: string, exact: string, options: { id?: number; sourcePath?: string; sourceTitle?: string } = {}): CapturedPassage {
  const projection = projectMarkdownBody(sourceBodyOf(sourceContent))
  const start = projection.text.indexOf(exact)
  const selector = start === -1
    ? unanchoredSelector({ before: '', exact, after: '' }, SOURCE_SHA)
    : selectorAt(projection, start, start + exact.length, SOURCE_SHA)
  if (!selector) throw new Error(`no selector for ${JSON.stringify(exact)}`)
  return {
    id: uuid(options.id ?? 1),
    sourcePath: options.sourcePath ?? 'Topics/example.md',
    sourceTitle: options.sourceTitle ?? 'Example',
    selector,
  }
}

/** The recipe's composed document for this capture, as the run driver would make it. */
export function composedFor(capture: CapturedPassage, answers: FormAnswers, mode: 'create' | 'append'): ComposedDocument {
  const destination = mode === 'create' ? { kind: 'newInFolder' as const, folderHandle: 'folder-1' } : { kind: 'existingDocument' as const, documentHandle: 'doc-1' }
  const { document, problems } = previewDocument(commentaryCommand(), {
    capture: { passage: 'passage-1', quote: capture.selector.exact, sourceTitle: capture.sourceTitle },
    answers,
    destination,
  })
  if (!document || problems.length > 0) throw new Error(`recipe refused: ${JSON.stringify(problems)}`)
  return document
}
