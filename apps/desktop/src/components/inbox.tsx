import { type KeyboardEvent, useEffect, useRef } from "react";
import { CaptureInbox } from "~/components/capture-inbox";
import { FeedRows, ProjectMenu, useFeed } from "~/components/feed";
import { InboxSection } from "~/components/inbox-section";
import { Group, type Rows, useSuggestions } from "~/components/suggestions";
import { bar, hideBar, inboxAt } from "~/lib/bar";
import { feedPrefs, wantFocus } from "~/lib/feed";
import { liveEditor } from "~/lib/live";
import { focusedPage } from "~/lib/panes";
import { useMobile } from "~/lib/platform";
import { projectPrefs } from "~/lib/project-runtime/prefs";

// The Inbox (features/bar.feature): what agents need, Tail's suggestions and captures to review, as
// sections of one list. ↑ and ↓ walk every row, Enter opens one, Esc gives the page the keyboard.
const ROW = "[data-inbox-row]";
const live = (rows: Rows) => rows.filter((r) => !r.leaving).length;

// Kept while one project is picked, so its menu can put all of them back.
function NeedsYou({ paneId }: { paneId?: string }) {
  const items = useFeed();
  const picked = feedPrefs.use().project !== "all";
  if (!items.length && !picked) return null;
  return (
    <InboxSection after={<ProjectMenu />} count={items.length} id="needs" title="Needs you">
      <FeedRows items={items} paneId={paneId} />
      {!items.length && <p className="px-4 text-muted-foreground text-sm">Nothing for this project.</p>}
    </InboxSection>
  );
}

export function InboxView({ paneId }: { paneId?: string }) {
  const mobile = useMobile();
  const { enabled } = projectPrefs.use();
  const { pinned } = bar.use();
  const { front, rows } = useSuggestions();
  const at = inboxAt.use();
  const scroller = useRef<HTMLDivElement>(null);
  const here = rows.filter((r) => r.line.where === front);
  const elsewhere = rows.filter((r) => r.line.where !== front);
  // Following the page: its suggestions lead, unless the pin keeps the order.
  const float = !pinned && live(here) > 0;
  const suggested = float ? elsewhere : rows;

  // The front page's suggestions show at once; run first, so a key opening a section wins.
  useEffect(() => void (float && scroller.current?.scrollTo({ top: 0 })), [float, front]);
  // Opened at a section, it scrolls there; opened by a key, its first row takes the keyboard.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // With the page's suggestions on top, Suggested starts there.
    const id = at === "suggested" && float ? "here" : at;
    const section = id ? el.querySelector<HTMLElement>(`[data-section="${id}"]`) : null;
    if (at) el.scrollTop = section?.offsetTop ?? 0;
    if (wantFocus.now) (section ?? el).querySelector<HTMLElement>(ROW)?.focus({ preventScroll: true });
    wantFocus.now = false;
    if (at) inboxAt.set(null);
  }, [at]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // Keys from its menus, which sit outside it, are theirs.
    if (!e.currentTarget.contains(t)) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      hideBar("inbox");
      const page = focusedPage();
      return void (page && liveEditor(page)?.refocus());
    }
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || t.closest("input, textarea, [role=group], [role=radiogroup], [role=combobox]")) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(ROW)];
    // From a row, or from a control inside one (a capture's project picker, a nod).
    const item = t.closest("li, [data-capture-id], [data-inbox-row]");
    const i = rows.findIndex((r) => r === t || item?.contains(r));
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    e.preventDefault();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3" onKeyDown={onKey} ref={scroller}>
      {float && (
        <InboxSection count={live(here)} id="here" title="On this page">
          <Group front={front} lit rows={here} />
        </InboxSection>
      )}
      {enabled && !mobile && <NeedsYou paneId={paneId} />}
      {suggested.length > 0 && (
        <InboxSection count={live(suggested)} id="suggested" title="Suggested">
          {float ? (
            <Group front={front} rows={elsewhere} />
          ) : (
            <>
              <Group front={front} lit rows={here} title="On this page" />
              <Group front={front} rows={elsewhere} title="Elsewhere" />
            </>
          )}
        </InboxSection>
      )}
      <CaptureInbox panel />
      <p className="m-auto hidden px-6 text-center text-muted-foreground text-sm only:block">Nothing needs you. Agents' questions, Tail's suggestions and your captures show here.</p>
    </div>
  );
}
