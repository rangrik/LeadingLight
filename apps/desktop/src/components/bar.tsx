import { Inbox, type LucideIcon, Pin, Plus, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Toggle } from "@leadinglight/ui/components/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { AskView } from "~/components/agent-panel";
import { useFeed } from "~/components/feed";
import { InboxView } from "~/components/inbox";
import { CARD } from "~/components/pane-area";
import { PanelHeader } from "~/components/panel-header";
import { closeAsk, openAsk } from "~/lib/ask";
import { bar, type BarView, NAMES, PANEL, type Section, showBar, showing, toggleBar, useNarrow, useShowing } from "~/lib/bar";
import { discoverVoiceCaptures, toReview } from "~/lib/capture-inbox";
import { wantFocus } from "~/lib/feed";
import { useKeysFor } from "~/lib/keymap";
import { useMobile } from "~/lib/platform";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { space } from "~/lib/space";
import { inPanel, tail } from "~/lib/tail";

// The bar (features/bar.feature): a strip of icons at the window's right edge, and the panel
// beside it that each opens. In a narrow window a view opens as a pane instead (lib/bar.ts).

const ICONS: Record<BarView, LucideIcon> = { inbox: Inbox, ask: Sparkles };
const ORDER: BarView[] = ["inbox", "ask"];
// The keys the Feed, Suggestions and Captures had open the Inbox at their section.
const AT: Record<string, Section | undefined> = { feed: "needs", suggestions: "suggested", captures: "captured" };

// A key or the strip. Ask goes through openAsk, so its composer takes the keyboard; from a key,
// the Inbox's first row does.
export function toggleView(view: BarView | "feed" | "suggestions" | "captures", key = true) {
  if (view === "ask") return showing("ask") ? closeAsk() : openAsk(null);
  const at = AT[view];
  wantFocus.now = key && (!!at || !showing("inbox"));
  if (at) showBar("inbox", at);
  else toggleBar("inbox");
}

// One number: what agents need while projects are on, unseen suggestions, captures to review.
// Counting the agents' items also keeps the Inbox following every agent while it is closed.
function InboxCount() {
  const { pages } = space.use();
  const ready = pages.length > 0;
  // Recordings saved before the inbox existed count too; found once per session.
  useEffect(() => void (ready && discoverVoiceCaptures().catch(() => {})), [ready]);
  const rest = toReview(pages).length + tail.use().filter((l) => inPanel(l) && !l.seen && !l.done).length;
  const mobile = useMobile();
  const feed = projectPrefs.use().enabled && !mobile;
  return feed ? <FeedCount plus={rest} /> : <Count n={rest} />;
}
const FeedCount = ({ plus }: { plus: number }) => <Count n={useFeed().length + plus} />;

function Count({ n }: { n: number }) {
  if (!n) return null;
  return (
    <Badge className="pointer-events-none absolute -top-0.5 -right-0.5" id="bar-count-inbox" size="sm">
      {n}
    </Badge>
  );
}

function StripButton({ view }: { view: BarView }) {
  const on = useShowing(view);
  const keys = useKeysFor()(view);
  const Icon = ICONS[view];
  return (
    <Tooltip>
      <TooltipTrigger render={<Toggle aria-describedby={view === "inbox" ? "bar-count-inbox" : undefined} aria-label={NAMES[view]} onPressedChange={() => toggleView(view, false)} pressed={on} />}>
        <Icon />
        {view === "inbox" && <InboxCount />}
      </TooltipTrigger>
      <TooltipPopup side="left">
        {NAMES[view]} <Kbd>{keys}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}

export function BarStrip({ onCapture }: { onCapture: () => void }) {
  const mobile = useMobile();
  const keys = useKeysFor()("new-idea");
  return (
    // Level with the page headers' middle line; the bottom button level with the cards' bottom edge.
    // The hairline is a half-pixel shadow: one device pixel on a Retina screen, where Chromium draws a border's 0.5 px as 2.
    <nav aria-label="Bar" className="flex w-10 shrink-0 flex-col items-center gap-1 pt-[calc(var(--header-height)/2_-_0.5rem)] pb-2 shadow-[inset_0.5px_0_0_var(--color-border)]" data-bar data-tauri-drag-region={!mobile || undefined}>
      {ORDER.filter((v) => !mobile || v === "inbox").map((v) => (
        <StripButton key={v} view={v} />
      ))}
      <span className="flex-1" data-tauri-drag-region={!mobile || undefined} />
      <Tooltip>
        <TooltipTrigger render={<Button aria-label="Quick capture" data-quick-capture onClick={onCapture} size="icon" variant="ghost" />}>
          <Plus />
        </TooltipTrigger>
        <TooltipPopup side="left">
          Quick capture <Kbd>{keys}</Kbd>
        </TooltipPopup>
      </Tooltip>
    </nav>
  );
}

// The view's name and what it adds; the Inbox's pin: on the page headers' line, a window drag area.
function BarHeader({ view, after }: { view: BarView; after?: ReactNode }) {
  const { pinned } = bar.use();
  return (
    <PanelHeader after={after} current={NAMES[view]} lead={false} sidebarOpen>
      {view === "inbox" && (
        <Tooltip>
          <TooltipTrigger render={<Toggle aria-label="Keep order" onPressedChange={() => bar.set({ pinned: !pinned })} pressed={pinned} size="sm" />}>
            <Pin />
          </TooltipTrigger>
          <TooltipPopup>Keep order</TooltipPopup>
        </Tooltip>
      )}
    </PanelHeader>
  );
}

// Its left edge resizes it, as the sidebar's does; saved once let go.
function PanelEdge({ width, onResize }: { width: number; onResize: (w: number | null) => void }) {
  return (
    <div
      aria-label="Resize the panel"
      aria-orientation="vertical"
      aria-valuemax={PANEL.max}
      aria-valuemin={PANEL.min}
      aria-valuenow={width}
      className="group/edge flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("select-none", "[&_iframe]:pointer-events-none");
        const offset = width + e.clientX;
        let w = width;
        const move = (ev: PointerEvent) => onResize((w = Math.min(PANEL.max, Math.max(PANEL.min, Math.round(offset - ev.clientX)))));
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.classList.remove("select-none", "[&_iframe]:pointer-events-none");
          bar.set({ width: w });
          onResize(null);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      role="separator"
    >
      <span className="h-8 w-1 rounded-full bg-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover/edge:opacity-100" />
    </div>
  );
}

// Beside the strip, pushing the pages; a pane instead in a narrow window.
export function BarPanel() {
  const mobile = useMobile();
  const { open, view, width } = bar.use();
  const [dragged, setDragged] = useState<number | null>(null);
  const isNarrow = useNarrow();
  if (!open || isNarrow || (mobile && view !== "inbox")) return null;
  const w = dragged ?? width;
  return (
    <>
      <PanelEdge onResize={setDragged} width={w} />
      <aside aria-label={NAMES[view]} className={cn(CARD, "flex shrink-0 flex-col overflow-hidden")} style={{ width: w }}>
        {view === "ask" ? (
          <AskView head={(menu) => <BarHeader after={<div className="ms-1 flex min-w-0">{menu}</div>} view="ask" />} />
        ) : (
          <>
            <BarHeader view={view} />
            <InboxView />
          </>
        )}
      </aside>
    </>
  );
}
