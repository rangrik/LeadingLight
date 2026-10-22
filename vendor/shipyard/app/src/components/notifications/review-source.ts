import { agentLabel } from "@/lib/derive";
import { dismiss, resolve, route, useNotifications } from "@/lib/notifications";
import { type ReviewEntry, signature, useReview, visibleEntries, watchReview } from "@/views/review/review-store";

// Review-ready notifications come from the review inbox: an item that is new,
// or has new work since it was last seen, becomes one; it settles when the
// item leaves the inbox (reviewed, committed, or the agent works again). The
// "finished" note for the same worktree folds into it.

let started = false;

export function watchReviewNotes() {
  if (started) return;
  started = true;
  watchReview();
  let seen: Map<string, string> | undefined;
  useReview.subscribe((s) => {
    if (!s.loaded || s.loading) return;
    const visible = visibleEntries(s);
    const now = new Map(visible.map((e) => [e.key, signature(e)]));
    if (seen) {
      for (const e of visible) if (seen.get(e.key) !== now.get(e.key)) announce(e);
    }
    // A box that failed to answer keeps its notes as they are.
    resolve((n) => n.category === "review" && !!n.box && !s.errors[n.box] && !now.has(`${n.box}|${n.path}`));
    seen = now;
  });
}

function announce(e: ReviewEntry) {
  const files = e.files.length + e.committed.length;
  const since = Date.now() - 15 * 60_000;
  for (const n of useNotifications.getState().notes) {
    if (n.category === "finished" && !n.resolved && n.box === e.box && n.path === e.path && new Date(n.time).getTime() > since) dismiss(n.id);
  }
  route({
    category: "review",
    title: `${agentLabel(e.agent || "an agent")} left changes to review`,
    detail: [files ? `${files} ${files === 1 ? "file" : "files"}` : undefined, `+${e.added} −${e.removed}`, e.branch].filter(Boolean).join(" · "),
    tone: "success",
    box: e.box,
    path: e.path,
    project: e.location,
    worktree: e.main ? undefined : e.worktree,
    session: e.session,
    action: { kind: "review", box: e.box, path: e.path },
    key: `review|${e.box}|${e.path}`,
  });
}
