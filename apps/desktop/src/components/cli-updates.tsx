import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@leadinglight/ui/components/button";
import { toastManager } from "@leadinglight/ui/components/toast";
import { behind, cliPrefs, commandOf, loadTools, type Tool, updateTool } from "~/lib/clis";

// Looks for newer Claude Code and Codex 10 s after the app opens, then hourly, and says so in a
// toast with Update all, Review and Skip (synara's). Unanswered it goes after 15 s, so it never
// sits over the Ask panel for long, and comes back next hour; a set once answered doesn't.

let showing: string | null = null;
export const closeUpdateToast = () => showing && toastManager.close(showing);
const names = (list: Tool[]) => list.map((t) => t.name).join(" and ");

export const reviewTools = () => useStore.getState().setView({ kind: "settings", section: "ai" });

export async function updateAll(list: Tool[]) {
  const id = toastManager.add({ type: "loading", title: `Updating ${names(list)}…`, timeout: 0 });
  const failed: { t: Tool; error: string }[] = [];
  for (const t of list) await updateTool(t.id).catch((e: Error) => failed.push({ t, error: e.message }));
  if (!failed.length) {
    toastManager.update(id, { type: "success", title: `${names(list)} updated`, description: "New sessions use the new version.", timeout: 6000 });
    return;
  }
  toastManager.update(id, {
    type: "error",
    title: `Couldn't update ${names(failed.map((f) => f.t))}`,
    timeout: 0,
    description: (
      <span className="flex flex-col gap-1">
        {failed.map((f) => (
          <span className="whitespace-pre-wrap break-words" key={f.t.id}>
            {f.error}
          </span>
        ))}
        <span>To update in Terminal:</span>
        {failed.map((f) => (
          <code className="select-text break-all rounded bg-muted px-1 font-mono text-xs" key={f.t.id}>
            {commandOf(f.t)}
          </code>
        ))}
      </span>
    ),
  });
}

async function check() {
  if (!cliPrefs.get().check || showing || Date.now() - cliPrefs.get().shown < 3_600_000) return;
  const due = (await loadTools()).filter(behind);
  const key = due.map((t) => `${t.id}:${t.latest}`).sort().join(" ");
  if (!due.length || key === cliPrefs.get().dismissed) return;
  const one = due.length === 1;
  let answered = false;
  const answer = (then?: () => void) => {
    answered = true;
    toastManager.close(id);
    then?.();
  };
  const id = toastManager.add({
    type: "warning",
    timeout: 15_000,
    title: one ? `${due[0].name} update available` : `${due.length} updates available`,
    description: (
      <span className="flex flex-col gap-2">
        {names(due)} {one ? "has a newer version" : "have newer versions"} available.
        <span className="flex gap-1.5">
          <Button onClick={() => answer(() => void updateAll(due))} size="xs">
            Update all
          </Button>
          <Button onClick={() => answer(reviewTools)} size="xs" variant="outline">
            Review
          </Button>
          <Button onClick={() => answer()} size="xs" variant="ghost">
            Skip
          </Button>
        </span>
      </span>
    ),
    onClose: () => {
      showing = null;
      if (answered) cliPrefs.set({ dismissed: key });
    },
  });
  showing = id;
  cliPrefs.set({ shown: Date.now() });
}

export function CliUpdates() {
  useEffect(() => {
    const first = window.setTimeout(check, 10_000);
    const hourly = window.setInterval(check, 3_600_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(hourly);
    };
  }, []);
  return null;
}
