// The current page, attached on the person's click: exactly the page in front when they clicked,
// after its pending text is saved. If that page, or the vault, is no longer the one in front once
// saving finishes, nothing is attached; another page is never taken in its place.

/**
 * Text taken from one page on the person's click. `key` names the page locally (its path), so
 * attaching the same page again replaces its chip; it is never sent and never shown.
 */
export interface TakenText { title: string; text: string; key?: string }

/** The page text attached, or why nothing was. `notMarkdown`: a chosen file Ask cannot take as text. */
export type PageSnapshot = TakenText | 'noPage' | 'notSaved' | 'pageChanged' | 'notMarkdown'

/**
 * The active pane's selection, captured synchronously by the host when the person chose Selected
 * passage (the E2 capture endpoint), or why nothing was taken.
 */
export type PassageSnapshot = TakenText | 'noSelection' | 'noPage' | 'notSaved' | 'pageChanged'

export interface PageSeam {
  /** The page in front, by path. */
  activePath: () => string | null
  /** The vault the window shows; another value means the person moved on. */
  vault: () => string
  /** Saves the page's pending text; rejects when it could not be saved. */
  settle: (path: string) => Promise<unknown>
  /** The open page's text and title as the editor now holds them, for exactly this path. */
  read: (path: string) => { title: string; text: string } | null
}

export async function snapshotPage(seam: PageSeam): Promise<PageSnapshot> {
  const path = seam.activePath()
  if (!path) return 'noPage'
  const vault = seam.vault()
  try {
    await seam.settle(path)
  } catch {
    return 'notSaved'
  }
  // A rename while saving (an untitled page getting its name) also lands here: attach it again.
  if (seam.vault() !== vault || seam.activePath() !== path) return 'pageChanged'
  const page = seam.read(path)
  return page ? { title: page.title, text: page.text, key: path } : 'noPage'
}
