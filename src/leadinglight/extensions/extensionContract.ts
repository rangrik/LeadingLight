// Extension package format, version 1, and the run shapes the host, native registry and UI share.
// A leaf: types and constants only. The public guide is docs/leadinglight/extensions-catalog.md.
// Packages are data. Nothing here evaluates code, follows paths or grants authority to an id.
import type { CommittedReceipt, ProposalReceipt } from '../proposals/proposalContract'

export const EXTENSION_SCHEMA = 'leadinglight.extension/1'

/** Bundled packages only; native refuses an import that uses it. */
export const RESERVED_PACKAGE_ID_PREFIX = 'leadinglight.'

export const EXTENSION_LIMITS = {
  /** UTF-8 bytes of the package text. */
  packageBytes: 128 * 1024,
  /** Nested objects and arrays, the package object being 1; the format itself needs 10. */
  jsonDepth: 12,
  commands: 8,
  /** Each operation appears at most once, in order. */
  steps: 6,
  formFields: 16,
  choiceOptions: 12,
  blocks: 48,
  listItems: 24,
  textParts: 12,
  /** ASCII characters. */
  idChars: 40,
  packageIdChars: 64,
  /** UTF-8 bytes of one name, title or label. */
  labelBytes: 200,
  /** UTF-8 bytes of one literal text part. */
  literalBytes: 1000,
  descriptionBytes: 1000,
  /** Diagnostics reported by one validation; the rest are marked truncated. */
  diagnostics: 32,
  /** UTF-8 bytes of one answer, captured quote or source title. */
  textAnswerBytes: 1000,
  multilineAnswerBytes: 64 * 1024,
  quoteBytes: 64 * 1024,
  sourceTitleBytes: 1000,
  /** UTF-8 bytes of all composed text after references are expanded, before Markdown encoding. */
  documentTextBytes: 256 * 1024,
} as const

// --- Vocabulary ---------------------------------------------------------------------------------

/** Effects and resources a command uses. Derived from its steps; a package must list exactly these. */
export const CAPABILITIES = ['selection.read', 'association.resolve', 'document.create', 'document.append', 'document.open'] as const
export type Capability = (typeof CAPABILITIES)[number]

/** What the first host milestone performs: form, chosen folder, exclusive create, open. */
export const E1_HOST_CAPABILITIES: readonly Capability[] = ['document.create', 'document.open']

/**
 * What the passage-commentary milestone performs once capture, association and guarded append are
 * all in place (src/leadinglight/commentary/). A host offers it only when every part actually works.
 */
export const E2_HOST_CAPABILITIES: readonly Capability[] = CAPABILITIES

/** The only operations, in the only order they may appear. */
export const STEP_OPERATIONS = [
  'capturePassage', 'collectForm', 'resolveDestination', 'composeDocument', 'proposeDocument', 'openCommittedResult',
] as const
export type StepOperation = (typeof STEP_OPERATIONS)[number]

export const DESTINATION_POLICIES = ['newInChosenFolder', 'chosenExistingDocument', 'associatedWithSource'] as const
export type DestinationPolicy = (typeof DESTINATION_POLICIES)[number]

export const FIELD_KINDS = ['text', 'multilineText', 'boolean', 'choice'] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

/** Blocks a package may write. The host alone adds the `source` block. */
export const BLOCK_TYPES = ['heading', 'paragraph', 'quote', 'list'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]
export const LIST_STYLES = ['bullet', 'numbered'] as const
export type ListStyle = (typeof LIST_STYLES)[number]
/** The note title is the only level 1 heading. */
export const HEADING_LEVELS = [2, 3, 4] as const
export type HeadingLevel = (typeof HEADING_LEVELS)[number]

/** The one value a captured passage offers to references; the quote itself is placed by the host. */
export const PASSAGE_FIELDS = ['sourceTitle'] as const

// --- Validated package (wire form; optional keys are filled in) -----------------------------------

/** A value produced by an earlier step: a form field, or `sourceTitle` of a captured passage. */
export interface FieldRef { readonly step: string; readonly field: string }
/** A string part is literal text, never Markdown, HTML or a template. */
export type TextPart = string | FieldRef

export interface ChoiceOption { readonly id: string; readonly label: string }
export type FormField =
  | { readonly kind: 'text' | 'multilineText'; readonly id: string; readonly label: string; readonly required: boolean }
  | { readonly kind: 'choice'; readonly id: string; readonly label: string; readonly required: boolean; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'boolean'; readonly id: string; readonly label: string }

/** `ifFilled`: keep the block only when that field has a value. */
export type BlockTemplate =
  | { readonly type: 'heading'; readonly level: HeadingLevel; readonly text: readonly TextPart[]; readonly ifFilled: FieldRef | null }
  | { readonly type: 'paragraph' | 'quote'; readonly text: readonly TextPart[]; readonly ifFilled: FieldRef | null }
  | { readonly type: 'list'; readonly style: ListStyle; readonly items: readonly (readonly TextPart[])[]; readonly ifFilled: FieldRef | null }

export type RecipeStep =
  /** Only with associatedWithSource: a capture never makes an arbitrary chosen note associated. */
  | { readonly op: 'capturePassage'; readonly id: string }
  | { readonly op: 'collectForm'; readonly id: string; readonly fields: readonly FormField[] }
  | { readonly op: 'resolveDestination'; readonly id: string; readonly policy: DestinationPolicy }
  /** `title` is present exactly when the destination may create a note. */
  | { readonly op: 'composeDocument'; readonly id: string; readonly title: readonly TextPart[] | null; readonly blocks: readonly BlockTemplate[] }
  | { readonly op: 'proposeDocument'; readonly id: string }
  | { readonly op: 'openCommittedResult'; readonly id: string }

export interface ExtensionCommand { readonly id: string; readonly title: string; readonly steps: readonly RecipeStep[] }

/** Frozen; only `parseExtensionPackage` makes one, and the run driver refuses any other object. */
export interface ExtensionPackage {
  readonly schema: typeof EXTENSION_SCHEMA
  readonly id: string
  readonly version: string
  readonly name: string
  readonly description: string
  /** In `CAPABILITIES` order. */
  readonly capabilities: readonly Capability[]
  readonly commands: readonly ExtensionCommand[]
}

// --- Diagnostics ----------------------------------------------------------------------------------

export const DIAGNOSTIC_CODES = [
  // Reading the text
  'tooLarge', 'invalidJson', 'tooDeep', 'duplicateKey', 'invalidNumber',
  // Shape
  'unknownField', 'missingField', 'wrongType', 'invalidValue', 'tooLong', 'tooMany',
  'unsupportedSchema', 'unknownOperation', 'unknownCapability', 'unsupportedValue', 'duplicateId',
  // Meaning
  'stepOrder', 'missingStep', 'notAllowed', 'unboundReference', 'forwardReference', 'incompatibleReference',
  'undeclaredCapability', 'unusedCapability',
] as const
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number]

export interface ExtensionDiagnostic {
  readonly code: DiagnosticCode
  /** JSON Pointer (RFC 6901) to the offending value or key; '' is the whole package. */
  readonly path: string
  /** One plain English sentence that says what to change. */
  readonly message: string
}

export type PackageValidation =
  | { readonly status: 'valid'; readonly extension: ExtensionPackage }
  | { readonly status: 'invalid'; readonly diagnostics: readonly ExtensionDiagnostic[]; readonly truncated: boolean }

// --- Review before activation ---------------------------------------------------------------------

export type WriteImpact = 'createInChosenFolder' | 'appendToChosenDocument' | 'createOrAppendAssociated'

/** Facts for host-written sentences; nothing here is package-supplied prose except the title. */
export interface CommandReview {
  readonly id: string
  readonly title: string
  /** A command that captures a passage needs a selection; every command is also in the palette. */
  readonly placement: 'selectionAction' | 'palette'
  readonly write: WriteImpact
  readonly opensResult: boolean
  readonly questions: number
  readonly requires: readonly Capability[]
  /** Required here but not performed by this host. */
  readonly missing: readonly Capability[]
}

export interface PackageReview {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly capabilities: readonly Capability[]
  readonly missing: readonly Capability[]
  /** Structurally valid packages stay `blocked` until the host performs every capability. */
  readonly activation: 'available' | 'blocked'
  readonly commands: readonly CommandReview[]
}

// --- One run --------------------------------------------------------------------------------------

/** Captured by the host from the request-time pane before focus moves. */
export interface PassageCapture {
  /** Opaque, run-bound token (see isOpaqueToken); only trusted host services resolve it. */
  readonly passage: string
  readonly quote: string
  readonly sourceTitle: string
}

export type AnswerValue = string | boolean | null
/** Keyed by field id; a missing key is an unanswered field. */
export type FormAnswers = Readonly<Record<string, AnswerValue>>

/** Chosen by the person through host controls and bound to the run natively; handles are opaque tokens. */
export type ChosenDestination =
  | { readonly kind: 'newInFolder'; readonly folderHandle: string }
  | { readonly kind: 'existingDocument'; readonly documentHandle: string }

export interface RunInput {
  readonly capture: PassageCapture | null
  readonly answers: FormAnswers
  readonly destination: ChosenDestination | null
}

/** Typed output; the host encodes it as safe Markdown. Text is literal and unescaped here. */
export type DocumentBlock =
  /**
   * Capture evidence for core association preparation, never a header to serialize as is. Host-made,
   * always first, and only in commands whose destination is associatedWithSource; a package cannot
   * write, move or omit it.
   * - New associated note: preparation writes exactly one structural `[Source](relative path)` link
   *   and one association metadata record, then the quote and the package's blocks.
   * - Adding to an existing associated note (E2): preparation checks that note's one association
   *   against this capture, extends its one metadata record and appends the quote and blocks, as one
   *   whole reviewed postimage. Title and link stay as they are; no second header, record or source.
   *   A malformed note, another source's note or a note changed since review stops the run with the
   *   person's input kept.
   */
  | { readonly type: 'source'; readonly passage: string; readonly quote: string }
  | { readonly type: 'heading'; readonly level: HeadingLevel; readonly text: string }
  | { readonly type: 'paragraph' | 'quote'; readonly text: string }
  | { readonly type: 'list'; readonly style: ListStyle; readonly items: readonly string[] }

export interface ComposedDocument {
  /** The new note's title; null when appending or when the recipe has none. */
  readonly title: string | null
  readonly blocks: readonly DocumentBlock[]
  /** UTF-8 bytes of the title and every block's text. */
  readonly textBytes: number
}

export type DocumentWrite =
  | { readonly mode: 'create'; readonly folderHandle: string }
  | { readonly mode: 'append'; readonly documentHandle: string }

export interface DocumentProposal {
  readonly operationId: string
  readonly runId: string
  readonly write: DocumentWrite
  readonly document: ComposedDocument
}

export const INPUT_PROBLEM_CODES = [
  'required', 'tooLong', 'notSingleLine', 'invalidAnswer', 'unknownAnswer',
  'invalidCapture', 'missingDestination', 'wrongDestination', 'outputTooLarge',
] as const
export type InputProblemCode = (typeof INPUT_PROBLEM_CODES)[number]
/** `field` names the form field concerned, when there is one. */
export interface InputProblem { readonly code: InputProblemCode; readonly field: string | null }

/** `document` is null only when the output limit was passed. Submit only with no problems. */
export interface DocumentPreview {
  readonly document: ComposedDocument | null
  readonly write: DocumentWrite | null
  readonly problems: readonly InputProblem[]
}

/** 'revoked': disabled, replaced, vault changed or run expired. */
export type RunLiveness = 'live' | 'cancelled' | 'revoked'

export interface RunStart {
  readonly extension: ExtensionPackage
  readonly commandId: string
  /** From an admission through the run's ExtensionSession (extensionApi.ts). */
  readonly runId: string
  /** One per run; a lost commit reply is queried with it, never resubmitted under another. */
  readonly operationId: string
  /** Taken at request time; null for a command without a capturePassage step. */
  readonly capture: PassageCapture | null
  readonly hostCapabilities: readonly Capability[]
}

export interface ReviewRequest {
  readonly runId: string
  readonly command: ExtensionCommand
  readonly capture: PassageCapture | null
}

/** The single dialog: form, destination and live preview, closed by Create/Add or cancel. */
export type ReviewDecision =
  | { readonly action: 'submit'; readonly answers: FormAnswers; readonly destination: ChosenDestination | null }
  | { readonly action: 'cancel' }

/**
 * Trusted host effects, injected per run. A preview adapter implements them with synthetic data
 * and no native calls. Packages never see these objects.
 */
export interface RunEffects {
  /** Consulted before and after every awaited effect; usually the session's liveness of this run. */
  liveness(): RunLiveness
  review(request: ReviewRequest): Promise<ReviewDecision>
  /** Encodes and submits exactly this proposal once. A rejection counts as an uncertain write. */
  commit(proposal: DocumentProposal): Promise<ProposalReceipt>
  /** Opens the committed page; false or a rejection is a navigation warning, never a retry. */
  open(receipt: CommittedReceipt): Promise<boolean>
}

export type RunRefusal = 'notValidated' | 'unknownCommand' | 'missingCapabilities' | 'invalidCapture' | 'invalidInput'
/** `skipped`: the run ended after the write, so its result was not opened. */
export type RunNavigation = 'opened' | 'failed' | 'skipped' | 'notRequested'

/** Every outcome but `committed` keeps the person's answers so the form can be offered again. */
export type RunOutcome =
  | { readonly status: 'committed'; readonly receipt: CommittedReceipt; readonly navigation: RunNavigation }
  | { readonly status: 'cancelled' | 'stale'; readonly answers: FormAnswers | null }
  | {
      readonly status: 'refused'; readonly reason: RunRefusal; readonly missing: readonly Capability[]
      readonly problems: readonly InputProblem[]; readonly answers: FormAnswers | null
    }
  /** Native proved nothing was written. */
  | { readonly status: 'notWritten'; readonly receipt: Extract<ProposalReceipt, { status: 'conflict' | 'refused' }>; readonly answers: FormAnswers }
  /** The write may already have committed: query `operationId` and never retry it automatically. */
  | { readonly status: 'uncertain'; readonly operationId: string; readonly answers: FormAnswers }
