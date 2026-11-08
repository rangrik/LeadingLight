import { agentOfTask } from "~/lib/assign";
import { feedItems, type FeedItem } from "~/lib/feed";
import { focusPane, holder, leaves, openTab, panes, placePage, showIn, showTab } from "~/lib/panes";
import { pageOf } from "~/lib/space";
import { reportOf, reportsOn } from "~/lib/work";

// Review side by side (features/review-side-by-side.feature): the task on the left, its report's
// own page on the right with the review strip. Made from the panes, so nothing is stored.

// Feed items that a review answers: a question, an approval, a report to read.
export const reviewable = (i: FeedItem) => !!i.task && ["question", "approval", "review", "answer"].includes(i.kind);

// What the right pane shows: the agent's newest report, else what its question is about, else the agent.
export function reviewPage(task: string): string | undefined {
  const agent = agentOfTask(pageOf(task));
  if (!agent) return;
  const report = reportsOn(task).filter((r) => reportOf(r)?.by === agent.id).at(-1);
  if (report) return report.id;
  const about = feedItems().find((i) => i.task === task && i.request)?.targets[0]?.page;
  return about && about !== task ? about : agent.id;
}

// The task a pane reviews: its page is a report on, or the review page of, a task in front beside it.
export function reviewOf(page: string, pane: string): string | undefined {
  const { root } = panes.get();
  if (!root || !pageOf(page)) return;
  const to = reportOf(pageOf(page))?.to;
  for (const l of leaves(root))
    if (l.id !== pane && agentOfTask(pageOf(l.page)) && (to === l.page || reviewPage(l.page) === page)) return l.page;
}

// The panes of a review already arranged, if any.
function arranged() {
  const { root } = panes.get();
  for (const l of root ? leaves(root) : []) {
    const task = reviewOf(l.page, l.id);
    const left = task && holder(task)?.leaf.id;
    if (left) return { left, right: l.id };
  }
}

// Shows a page in front where it is open, else in the pane given; the pane it is in.
function put(page: string, pane: string) {
  const open = holder(page);
  if (open) showTab(open.leaf.id, open.tab.id);
  else showIn(pane, page);
  return open?.leaf.id ?? pane;
}

// Arranges the review of a task, reusing its panes: the task where it is open, else in the review
// already arranged, else a new tab of the pane in use; the report beside it, the right one focused.
export function openReview(task: string) {
  const right = reviewPage(task);
  if (!right) return;
  const was = arranged();
  const left = holder(task) || was ? put(task, was?.left ?? "") : (openTab(task), panes.get().focus);
  const shown = holder(right)?.leaf.id;
  const into = shown && shown !== left ? shown : was && was.right !== left ? was.right : undefined;
  if (into) focusPane(put(right, into));
  else placePage(right, left, "right");
  // The brief at the top, its card in view.
  requestAnimationFrame(() => document.querySelector(`[data-pane="${CSS.escape(left)}"] [data-page-scroller]`)?.scrollTo({ top: 0 }));
}
