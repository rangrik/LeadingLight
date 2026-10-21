// The current page, attached on the person's click: exactly the page in front when they clicked,
// after its pending text is saved. If that page, or the vault, is no longer the one in front once
// saving finishes, nothing is attached; another page is never taken in its place.

/** The page text attached, or why nothing was. */
export type PageSnapshot = { title: string; text: string } | 'noPage' | 'notSaved' | 'pageChanged'

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
  return seam.read(path) ?? 'noPage'
}
