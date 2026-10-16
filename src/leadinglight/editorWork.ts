// In-flight editor imports (pasted, dropped or chosen images and files), so a page move can wait for them.
const pending = new Set<Promise<unknown>>()

export function trackEditorWork<T>(work: Promise<T>): Promise<T> {
  pending.add(work)
  const done = () => { pending.delete(work) }
  work.then(done, done)
  return work
}

/** Resolves once every tracked import has finished and its result had a turn to reach the editor. */
export async function editorWorkSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending])
  await new Promise(resolve => setTimeout(resolve, 0))
}
