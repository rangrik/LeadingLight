import { CircleCheck, Info, MessageCircleQuestion, MessageSquareReply, ShieldQuestion } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Input } from "@leadinglight/ui/components/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { cn } from "@leadinglight/ui/lib/utils";
import { ApprovalCard, DeliveryLine, QuestionCard } from "~/components/agent-requests";
import { accept } from "~/lib/assign";
import { feedItems, type FeedItem, feedPrefs, followAgents, showTarget, wantFocus } from "~/lib/feed";
import { formatAgo } from "~/lib/format";
import { pageLabel } from "~/lib/labels";
import { accessOf, answer, chatOf, send } from "~/lib/project-runtime/chat";
import { folders } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { deliveryOf } from "~/lib/project-runtime/requests";
import { pageOf, space } from "~/lib/space";
import type { Target } from "~/lib/work";
import { sessions, watchWork } from "~/lib/work-watch";

// The Feed (features/feed.feature): a panel of the bar (components/bar.tsx), or a pane of its own
// in a narrow window. Selecting an item opens what it is about beside it; a question or an
// approval is answered in the item, as in its chat, through the same receipts.

const ICON = { question: MessageCircleQuestion, approval: ShieldQuestion, review: CircleCheck, answer: MessageSquareReply, notice: Info };
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

// A reply to an agent that asked in its own words: a message to its chat, as the chat would send.
function Reply({ item }: { item: FeedItem }) {
  const { key, location } = item.reply!;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const conv = chatOf(key).get().conv;
    if (!conv || !text.trim()) return;
    setSending(true);
    setError(null);
    send(key, location, text.trim(), { model: conv.model ?? "", effort: conv.effort ?? "", ...accessOf(conv.mode, conv.agent === "codex" ? "codex" : "claude") })
      .then(() => setText(""), (e: Error) => setError(e.message))
      .finally(() => setSending(false));
  };
  return (
    <form className="flex flex-col gap-1.5" onSubmit={(e) => (e.preventDefault(), go())}>
      <div className="flex gap-1.5">
        <Input aria-label="Your reply" disabled={sending} onChange={(e) => setText(e.currentTarget.value)} placeholder="Reply" size="sm" value={text} />
        <Button disabled={sending || !text.trim()} size="sm" type="submit">
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error && <p className="text-destructive-foreground text-xs">Not sent: {error}</p>}
    </form>
  );
}

function FeedRow({ item, open, onSelect, paneId }: { item: FeedItem; open: boolean; onSelect: () => void; paneId?: string }) {
  const Icon = ICON[item.kind];
  const meta = [item.task ? title(item.task) : title(item.agent), title(item.project), formatAgo(item.at)].filter(Boolean).join(" · ");
  return (
    <li className={cn("rounded-lg transition-colors duration-150", open ? "bg-accent/60" : "hover:bg-accent/40")} data-feed-item={item.id}>
      {/* The item with the keyboard is tinted, as one under the pointer is; no ring. */}
      <button aria-expanded={open} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:bg-accent/60" onClick={onSelect} type="button">
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
          {item.reply && <Reply item={item} />}
          {!item.request && !item.reply && (
            <div className="flex gap-1">
              {item.kind === "review" && item.task && (
                <Button onClick={() => void accept(item.task!, item.targets[0]?.page)} size="xs">
                  Accept
                </Button>
              )}
              <Button onClick={() => feedPrefs.set({ dismissed: [...feedPrefs.get().dismissed, item.id].slice(-200) })} size="xs" variant="ghost">
                {item.kind === "notice" ? "Dismiss" : "Later"}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// The list, its project filter, and keys: ↑ and ↓ move, Enter opens. Only while projects are on.
export function FeedList({ paneId }: { paneId?: string }) {
  const items = useFeed();
  const prefs = feedPrefs.use();
  const { enabled } = projectPrefs.use();
  const all = folders.use();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const projects = [...all.values()].map((f) => f.folder.pageId);
  useEffect(() => {
    if (!wantFocus.now) return;
    wantFocus.now = false;
    // The first item, or with none the Feed's project menu.
    (list.current?.querySelector<HTMLButtonElement>(":scope > li > button") ?? root.current?.querySelector<HTMLElement>("[aria-label=Project]"))?.focus();
  }, [items.length]);
  const select = (item: FeedItem) => {
    setSelected(item.id === selected ? null : item.id);
    requestAnimationFrame(() => list.current?.querySelector(`[data-feed-item="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: "nearest" }));
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
  const none = <p className="m-auto px-6 text-center text-muted-foreground text-sm">Nothing needs you. Questions, approvals and work ready for review show here.</p>;
  if (!enabled) return none;
  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={root}>
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
        none
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

// In a pane of its own: what an item is about opens in this pane, its crumb leading back.
export function FeedView({ paneId }: { paneId: string }) {
  return (
    <div className="flex h-full flex-col pt-2" data-testid="feed">
      <FeedList paneId={paneId} />
    </div>
  );
}
