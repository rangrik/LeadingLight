import { toastManager } from "@leadinglight/ui/components/toast";

// The pending-save flushers of open pages, so anything that ends the page can save first.
const flushers = new Set<() => unknown>();

export function trackFlush(flush: () => unknown): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export function flushAll(): Promise<unknown> {
  return Promise.all([...flushers].map((flush) => flush()));
}

// A page's last save as its editor closes, so the next editor of that page reads every word.
const closing = new Map<string, Promise<unknown>>();
export function closeSave(id: string, save: Promise<unknown>) {
  closing.set(id, save);
  void save.catch(() => {}).finally(() => closing.get(id) === save && closing.delete(id));
}
export const whenSaved = (id: string) => (closing.get(id) ?? Promise.resolve()).catch(() => {});

let showing = false;

// One toast at a time; the edit stays on screen, so nothing typed is gone yet.
export function reportSaveError(error: unknown): void {
  console.error(error);
  if (showing) return;
  showing = true;
  toastManager.add({
    type: "error",
    title: "Couldn't save your changes",
    description: "They're still on the page. Keep this window open and try again in a moment.",
    onClose: () => {
      showing = false;
    },
  });
}
