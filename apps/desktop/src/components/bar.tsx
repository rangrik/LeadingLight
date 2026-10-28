import { Inbox, type LucideIcon, MessageSquareDashed, MessagesSquare, Pin, Plus, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Toggle } from "@leadinglight/ui/components/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { AskView } from "~/components/agent-panel";
import { CaptureInbox, SaveWebpageButton } from "~/components/capture-inbox";
import { FeedList, useFeed } from "~/components/feed";
import { CARD } from "~/components/pane-area";
import { PanelHeader } from "~/components/panel-header";
import { Suggestions } from "~/components/suggestions";
import { closeAsk, openAsk } from "~/lib/ask";
import { bar, type BarView, NAMES, narrow, PANEL, showing, toggleBar, useNarrow, useShowing } from "~/lib/bar";
import { discoverVoiceCaptures, toReview } from "~/lib/capture-inbox";
import { wantFocus } from "~/lib/feed";
import { useKeysFor } from "~/lib/keymap";
import { focusedPage, panes } from "~/lib/panes";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { isPageView, space } from "~/lib/space";
import { inPanel, suggestionsOn, tail } from "~/lib/tail";

// The bar (features/bar.feature): a strip of icons at the window's right edge, and the panel
// beside it that each opens. In a narrow window a view opens as a pane instead (lib/bar.ts).

const ICONS: Record<BarView, LucideIcon> = { suggestions: MessageSquareDashed, feed: MessagesSquare, captures: Inbox, ask: Sparkles };
const ORDER: BarView[] = ["suggestions", "feed", "captures", "ask"];

// Ask goes through openAsk, so its composer takes the keyboard; the Feed's first item does.
export function toggleView(view: BarView) {
  if (view === "ask") return showing("ask") ? closeAsk() : openAsk(null);
  if (view === "feed") wantFocus.now = !showing("feed");
  toggleBar(view);
}

function Count({ n, view }: { n: number; view: BarView }) {
  if (!n) return null;
  return (
    <Badge className="pointer-events-none absolute -top-0.5 -right-0.5" id={`bar-count-${view}`} size="sm">
      {n}
    </Badge>
  );
}

// The Feed's count also keeps it following every agent while its panel is closed.
function FeedCount() {
  return <Count n={useFeed().length} view="feed" />;
}

function CapturesCount() {
  const { pages } = space.use();
  const ready = pages.length > 0;
  // Recordings saved before the inbox existed count too; found once per session.
  useEffect(() => void (ready && discoverVoiceCaptures().catch(() => {})), [ready]);
  return <Count n={toReview(pages).length} view="captures" />;
}

// What tail offers that the panel has not shown yet.
function SuggestionsCount() {
  return <Count n={tail.use().filter((l) => inPanel(l) && !l.seen && !l.done).length} view="suggestions" />;
}

function StripButton({ view }: { view: BarView }) {
  const on = useShowing(view);
  const keys = useKeysFor()(view);
  const Icon = ICONS[view];
  const { enabled: projectsOn } = projectPrefs.use();
  return (
    <Tooltip>
      <TooltipTrigger render={<Toggle aria-describedby={`bar-count-${view}`} aria-label={NAMES[view]} onPressedChange={() => toggleView(view)} pressed={on} />}>
        <Icon />
        {view === "feed" && projectsOn && <FeedCount />}
        {view === "captures" && <CapturesCount />}
        {view === "suggestions" && <SuggestionsCount />}
      </TooltipTrigger>
      <TooltipPopup side="left">
        {NAMES[view]} <Kbd>{keys}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}

export function BarStrip({ onCapture }: { onCapture: () => void }) {
  const keys = useKeysFor()("new-idea");
  // Following: a page coming to the front with suggestions shows Suggestions, unless pinned.
  useEffect(() => {
    let front = focusedPage();
    return panes.subscribe(() => {
      const now = focusedPage();
      if (now === front) return;
      front = now;
      const { open, pinned } = bar.get();
      if (now && open && !pinned && !narrow() && isPageView(now) && suggestionsOn(now).length) bar.set({ view: "suggestions" });
    });
  }, []);
  return (
    // Level with the page headers' middle line; the bottom button level with the cards' bottom edge.
    // The hairline is a half-pixel shadow: one device pixel on a Retina screen, where Chromium draws a border's 0.5 px as 2.
    <nav aria-label="Bar" className="flex w-10 shrink-0 flex-col items-center gap-1 pt-[calc(var(--header-height)/2_-_0.5rem)] pb-2 shadow-[inset_0.5px_0_0_var(--color-border)]" data-bar data-tauri-drag-region>
      {ORDER.map((v) => (
        <StripButton key={v} view={v} />
      ))}
      <span className="flex-1" data-tauri-drag-region />
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

// The view's name, a pin, and what the view adds: on the page headers' line, a window drag area.
function BarHeader({ view, after, children }: { view: BarView; after?: ReactNode; children?: ReactNode }) {
  const { pinned } = bar.use();
  return (
    <PanelHeader after={after} current={NAMES[view]} lead={false} sidebarOpen>
      {children}
      <Tooltip>
        <TooltipTrigger render={<Toggle aria-label="Pin" onPressedChange={() => bar.set({ pinned: !pinned })} pressed={pinned} size="sm" />}>
          <Pin />
        </TooltipTrigger>
        <TooltipPopup>
          {pinned ? "Unpin" : "Pin"}
          {!pinned && <span className="block text-muted-foreground">Keeps {NAMES[view]} here when a page has suggestions</span>}
        </TooltipPopup>
      </Tooltip>
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
  const { open, view, width } = bar.use();
  const [dragged, setDragged] = useState<number | null>(null);
  const isNarrow = useNarrow();
  if (!open || isNarrow) return null;
  const w = dragged ?? width;
  return (
    <>
      <PanelEdge onResize={setDragged} width={w} />
      <aside aria-label={NAMES[view]} className={cn(CARD, "flex shrink-0 flex-col overflow-hidden")} style={{ width: w }}>
        {view === "ask" ? (
          <AskView head={(menu) => <BarHeader after={<div className="ms-1 flex min-w-0">{menu}</div>} view="ask" />} />
        ) : (
          <>
            <BarHeader view={view}>{view === "captures" && <SaveWebpageButton />}</BarHeader>
            <div className="flex min-h-0 flex-1 flex-col">
              {view === "feed" ? (
                <FeedList />
              ) : view === "captures" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <CaptureInbox panel />
                </div>
              ) : (
                <Suggestions />
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
