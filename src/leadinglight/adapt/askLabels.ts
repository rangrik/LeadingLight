// The words the first Ask slice adds to the Adapt dialog, supplied by the host from its locale (the
// keys are listed in docs/leadinglight/ask-experience.md). Until the host supplies them, the parts
// that need them (Copy, Selected passage, Another page…) are simply not offered; everything else uses
// keys the app already has.

export interface AskLabels {
  /** The answer's Copy button. */
  copy: string
  /** Said once the exact answer is on the clipboard. */
  copied: string
  /** Said when it could not be copied; the answer stays, shown as Markdown to select by hand. */
  copyFailed: string
  /** Attach menu: the active pane's selection, taken on that click. */
  attachPassage: string
  /** Attach menu: a page chosen in the finder. */
  attachAnotherPage: string
  /** Nothing was selected when Selected passage was chosen. */
  noSelection: string
  /** A passage chip's label; the title is the page's, never its path. */
  passageFrom: (title: string) => string
}

/** The Ask words from the app's locale. */
export function askLabelsFor(t: (key: AskLabelKey, values?: { title: string }) => string): AskLabels {
  return {
    copy: t('leadinglight.ask.copy'),
    copied: t('leadinglight.ask.copied'),
    copyFailed: t('leadinglight.ask.copyFailed'),
    attachPassage: t('leadinglight.ask.attachPassage'),
    attachAnotherPage: t('leadinglight.ask.attachAnotherPage'),
    noSelection: t('leadinglight.ask.noSelection'),
    passageFrom: title => t('leadinglight.ask.passageFrom', { title }),
  }
}

type AskLabelKey =
  | 'leadinglight.ask.copy' | 'leadinglight.ask.copied' | 'leadinglight.ask.copyFailed' | 'leadinglight.ask.attachPassage'
  | 'leadinglight.ask.attachAnotherPage' | 'leadinglight.ask.noSelection' | 'leadinglight.ask.passageFrom'
