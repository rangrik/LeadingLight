import type { TypeInstanceDefault } from '../../hooks/useNoteCreation'

export interface TemplateSource { vaultPath: string; path: string }

/** Captures a vault session and destination pane before any asynchronous work. */
export interface TemplateScope {
  id: string
  vaultPath: string
  cancel(): void
}

export interface TemplateSnapshot {
  source: TemplateSource
  title: string
  template: string | null
  defaults: TypeInstanceDefault[]
  /** Vault relative; empty means the workspace folder. */
  destinationDirectory: string
  /** Opaque comparison of resolved creation values, not a modification time. */
  revision: string
}

export interface TemplatePreview {
  snapshot: TemplateSnapshot
  /** Complete proposed page bytes, including type and default frontmatter. */
  content: string
}

export type TemplateDraft =
  | { kind: 'existing'; source: TemplateSource; expected: TemplateSnapshot; text: string; revision: number }
  | { kind: 'new'; name: string; text: string; revision: number }

export type TemplateFailure = 'busy' | 'stale' | 'missing' | 'invalidSource' | 'empty'
  | 'saveHeld' | 'readFailed' | 'writeFailed' | 'collision' | 'unconfirmed'

export type TemplateReadResult =
  | { status: 'ready'; snapshot: TemplateSnapshot; preview: TemplatePreview | null }
  | { status: 'failed'; reason: TemplateFailure }

export type TemplateSaveResult =
  | { status: 'saved'; source: TemplateSource; snapshot: TemplateSnapshot; text: string; revision: number; refreshPending: boolean }
  | { status: 'sourceChanged'; snapshot: TemplateSnapshot; revision: number }
  | { status: 'failed'; reason: TemplateFailure; revision: number;
      write: 'notStarted' | 'unconfirmed'; attemptedPath?: string }

export type TemplateCreateResult =
  | { status: 'opened' | 'created'; path: string }
  | { status: 'previewChanged'; preview: TemplatePreview }
  | { status: 'failed'; reason: TemplateFailure; write: 'notStarted' | 'unconfirmed'; attemptedPath?: string }

/**
 * Available as notes.templates from useNoteActions; no extra App hook binding.
 * A second explicit save/create reconciles that scope's retained attempt first.
 * A saved receipt can belong to an older draft revision; retain newer local text.
 */
export interface TemplateController {
  begin(): TemplateScope | null
  prepare(scope: TemplateScope, source: TemplateSource): Promise<TemplateReadResult>
  save(scope: TemplateScope, draft: TemplateDraft): Promise<TemplateSaveResult>
  create(scope: TemplateScope, preview: TemplatePreview): Promise<TemplateCreateResult>
  /** Synchronous, nestable admission hold. Release even when a boundary refuses. */
  holdAdmission(): () => void
  /** Joins already admitted work; does not itself prevent new admission. */
  whenIdle(): Promise<void>
}
