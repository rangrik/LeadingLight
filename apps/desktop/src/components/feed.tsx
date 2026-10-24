import { CircleCheck, Inbox, Info, MessageCircleQuestion, ShieldQuestion, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { cn } from "@leadinglight/ui/lib/utils";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { CARD } from "~/components/pane-area";
import { PanelHeader } from "~/components/panel-header";
import { feedItems, type FeedItem, feedPrefs, followAgents, showTarget } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { answer, chatOf } from "~/lib/project-runtime/chat";
import { folders } from "~/lib/project-runtime/folders";
import { deliveryOf } from "~/lib/project-runtime/requests";
import { pageOf, space } from "~/lib/space";
import type { Target } from "~/lib/work";
import { sessions, watchWork } from "~/lib/work-watch";

// The Feed (features/feed.feature): a lane between the sidebar and the pages, or a pane of its own
// in a narrow window. Selecting an item opens what it is about beside it; a question or an
// approval is answered in the item, as in its chat, through the same receipts.

export const FEED_W = 320;
const ICON = { question: MessageCircleQuestion, approval: ShieldQuestion, review: CircleCheck, notice: Info };
const title = (id?: string) => (id ? pageLabel(pageOf(id)?.title ?? "") : "");

// The items, kept current as the runtime, the chats and the pages change.
export function useFeed() {
  const { pages } = space.use();
  const live = sessions.use();
  const prefs = feedPrefs.use();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    watchWork();
    void followAgents();
    // Each followed chat's store says when its requests change.
    const offs = pages.flatMap((p) => (p.properties.run ? [chatOf((p.properties.run as { conversation: string }).conversation).subscribe(() => setTick((t) => t + 1))] : []));
    return () => offs.forEach((off) => off());
  }, [pages]);
  return useMemo(() => feedItems().filter((i) => prefs.project === "all" || i.project === prefs.project), [pages, live, prefs, tick]);
}

function TargetLink({ t, onOpen }: { t: Target; onOpen: () => void }) {
  const what = t.quote ? `“${t.quote.length > 60 ? `${t.quote.slice(0, 60)}…` : t.quote}” in ${title(t.page)}` : t.block ? `${title(t.page)}, block ${t.block}${t.at !== undefined ? ` at ${Math.floor(t.at / 60)}:${String(Math.floor(t.at % 60)).padStart(2, "0")}` : ""}` : title(t.page);
  return (
    <button className="max-w-full truncate rounded-md border px-1.5 py-0.5 text-left text-xs transition-colors duration-150 hover:bg-accent" onClick={onOpen} type="button">
      {what}
    </button>
  );
}

function Answer({ item }: { item: FeedItem }) {
  const { key, request } = item.request!;
  const chat = chatOf(key).use();
  const r = chat.requests.find((x) => x.id === request.id) ?? request;
  const draft = chat.answers[r.id];
  const sent = chat.deliveries[r.id];
  const delivery = sent?.delivery === "sending" || sent?.delivery === "failed" ? sent.delivery : deliveryOf(r, draft, false, false);
  const busy = delivery !== "pending" && delivery !== "failed";
  const line = <DeliveryLine delivery={delivery} error={sent?.error} onRetry={() => draft && answer(key, r, draft.answer, draft.index, true)} />;
  return r.kind === "question" ? (
    <QuestionCard answer={draft?.answer ?? {}} busy={busy} index={draft?.index ?? 0} onAnswer={(a, index, submit) => answer(key, r, a, index, submit)} request={r}>
      {line}
    </QuestionCard>
  ) : (
    <ApprovalCard busy={busy} onChoose={(choice) => answer(key, r, { choice }, 0, true)} request={r}>
      {line}
    </ApprovalCard>
  );
}

function FeedRow({ item, open, onSelect, paneId }: { item: FeedItem; open: boolean; onSelect: () => void; paneId?: string }) {
  const Icon = ICON[item.kind];
  const meta = [item.task ? title(item.task) : title(item.agent), title(item.project), formatAgo(item.at)].filter(Boolean).join(" · ");
  return (
    <li className={cn("rounded-lg transition-colors duration-150", open ? "bg-accent/60" : "hover:bg-accent/40")} data-feed-item={item.id}>
      <button aria-expanded={open} className="flex w-full items-start gap-2.5 px-2.5 py-2 text-left" onClick={onSelect} type="button">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", !open && "line-clamp-2")}>{item.reason}</span>
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">{meta}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5 ps-9">
          {item.targets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.targets.map((t, i) => (
                <TargetLink key={i} onOpen={() => showTarget(t, paneId)} t={t} />
              ))}
            </div>
          )}
          {item.note && <p className="text-muted-foreground text-xs">{item.note}</p>}
          {item.request && (
            <div className="-mx-2">
              <Answer item={item} />
            </div>
          )}
          {(item.kind === "review" || item.kind === "notice") && (
            <div className="flex gap-1">
              <Button onClick={() => feedPrefs.set({ dismissed: [...feedPrefs.get().dismissed, item.id].slice(-200) })} size="xs" variant="ghost">
                {item.kind === "review" ? "Later" : "Dismiss"}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// The list, its project filter, and keys: ↑ and ↓ move, Enter opens.
function FeedList({ paneId }: { paneId?: string }) {
  const items = useFeed();
  const prefs = feedPrefs.use();
  const all = folders.use();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const projects = [...all.values()].map((f) => f.folder.pageId);
  const select = (item: FeedItem) => {
    setSelected(item.id === selected ? null : item.id);
    if (item.id !== selected && item.targets[0] && !paneId) showTarget(item.targets[0]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if ((e.target as HTMLElement).closest("input, textarea, [role=group]")) return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    e.preventDefault();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-2">
        <Select items={{ all: "All projects", ...Object.fromEntries(projects.map((p) => [p, title(p)])) }} onValueChange={(v) => feedPrefs.set({ project: v as string })} value={projects.includes(prefs.project) ? prefs.project : "all"}>
          <SelectTrigger aria-label="Project" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p} value={p}>
                {title(p)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {items.length === 0 ? (
        <p className="m-auto px-6 text-center text-muted-foreground text-sm">Nothing needs you. Questions, approvals and work ready for review show here.</p>
      ) : (
        <ul aria-label="Feed items" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" onKeyDown={onKey} ref={list}>
          {items.map((item) => (
            <FeedRow item={item} key={item.id} onSelect={() => select(item)} open={item.id === selected} paneId={paneId} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Beside the sidebar, while the window has room for it and a page.
export function FeedLane({ windowToggle, sidebarOpen }: { windowToggle: boolean; sidebarOpen: boolean }) {
  return (
    <aside aria-label="Feed" className={cn(CARD, "me-2 flex shrink-0 flex-col overflow-hidden")} data-testid="feed" style={{ width: FEED_W }}>
      <PanelHeader current="Feed" icon={<Inbox className="size-4" />} sidebarOpen={sidebarOpen} toggle={!windowToggle}>
        <Button aria-label="Close the Feed" onClick={() => feedPrefs.set({ open: false })} size="icon-xs" variant="ghost">
          <X className="size-4" />
        </Button>
      </PanelHeader>
      <FeedList />
    </aside>
  );
}

// In a pane of its own: what an item is about opens in this pane, its crumb leading back.
export function FeedView({ paneId }: { paneId: string }) {
  return (
    <div className="flex h-full flex-col pt-2" data-testid="feed">
      <FeedList paneId={paneId} />
    </div>
  );
}
