import type { BlockEditorHandle, NotesStore } from "@leadinglight/editor/editor";
import { type RefObject, useEffect, useMemo, useSyncExternalStore } from "react";
import { makeRoom } from "~/lib/essay";
import { draftOf, drafts, noteStates, pick, recipientFor } from "~/lib/feedback";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import type { ObjectSummary } from "~/lib/objects";
import { recalling } from "~/lib/recall";
import { pageOf, space } from "~/lib/space";
import { useThoughts } from "~/lib/thoughts";
import { reportOf } from "~/lib/work";

// The editors showing each report's words: its own page and its place under its task.
const showing = new Map<string, Set<RefObject<BlockEditorHandle | null>>>();

// A page's sidenotes wherever its words show (DECISIONS.md, 24). On a task's pages each note can be
// ticked to go to its agent; a report's notes added or taken off in one editor show in the others.
export function useNotesFor(page: ObjectSummary, editor: RefObject<BlockEditorHandle | null>) {
  const notes = useThoughts(page, (thoughts) => {
    if (thoughts) void editPage(page.id, { properties: (p) => ({ ...p, thoughts: thoughts.id }) });
    // A line saved from Recall keeps the layout still: nothing moves (docs/TAIL.md).
    if (!recalling.get().includes(page.id)) makeRoom();
  });
  // Only when this page's task or its sent notes change does the page draw again.
  const pickKey = useSyncExternalStore(space.subscribe, () => {
    const to = recipientFor(page.id);
    return to ? `${to.task} ${to.agent} ${JSON.stringify([...noteStates()])}` : "";
  });
  const chosen = drafts.use();
  const ticked = useMemo<NotesStore | undefined>(() => {
    if (!notes || !pickKey) return notes;
    const [task, agent, ...rest] = pickKey.split(" ");
    const states = new Map<string, string>(JSON.parse(rest.join(" ")));
    const to = pageLabel(pageOf(agent)?.title ?? "").split(": ")[0];
    return { ...notes, pick: { to, page: pageLabel(page.title), on: (id) => draftOf(task).picks.some((x) => x.note === id), set: (id, on) => pick(task, page.id, id, on), sent: (id) => states.get(id) } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, pickKey, chosen]);

  const report = !!reportOf(page);
  useEffect(() => {
    if (!report) return;
    const all = showing.get(page.id) ?? new Set();
    showing.set(page.id, all.add(editor));
    return () => {
      all.delete(editor);
      if (!all.size) showing.delete(page.id);
    };
  }, [page.id, report, editor]);
  const onNoteSteps = report ? (steps: unknown[]) => showing.get(page.id)?.forEach((e) => e !== editor && e.current?.applySteps(steps)) : undefined;
  return { notes: ticked, onNoteSteps };
}
