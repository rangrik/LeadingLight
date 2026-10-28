import { ChevronLeft, ChevronRight, FileText, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@leadinglight/ui/components/empty";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Tabs, TabsList, TabsTab } from "@leadinglight/ui/components/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { armDrag } from "~/components/pane-drag";
import { useKeysFor } from "~/lib/keymap";
import { closeTab, type Leaf, newTab, openPage, pageIn, showTab, type Tab, travel } from "~/lib/panes";
import { describe } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { newPage } from "~/lib/templates";

// A header button with its tooltip and key, as the card's others have.
function KeyButton({ id, label, onClick, disabled, children }: { id: string; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  const keys = useKeysFor()(id);
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} disabled={disabled} onClick={onClick} size="icon-xs" variant="ghost" />}>{children}</TooltipTrigger>
      <TooltipPopup>
        {label} <Kbd>{keys}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}

// Back and forward through the front tab's pages, muted when there is nowhere to go. They give
// way in a narrow card, as Ask does, so the title stays whole; ⌘[ and ⌘] still work.
export function History({ pane, tab }: { pane: string; tab: Tab }) {
  return (
    <div className="-ms-1 hidden shrink-0 items-center @[20rem]/header:flex">
      <KeyButton disabled={tab.at === 0} id="back" label="Back" onClick={() => travel(-1, pane)}>
        <ChevronLeft className="size-4" />
      </KeyButton>
      <KeyButton disabled={tab.at === tab.pages.length - 1} id="forward" label="Forward" onClick={() => travel(1, pane)}>
        <ChevronRight className="size-4" />
      </KeyButton>
    </div>
  );
}

// A pane's tabs, above its header while it has two or more. The row's own room drags the window in the app.
export function TabRow({ leaf, inset }: { leaf: Leaf; inset: boolean }) {
  return (
    <Tabs
      className={cn("h-(--header-height) shrink-0 flex-row items-center gap-1 border-b px-2 transition-[padding] duration-200 ease-linear", inset && "ps-[calc(var(--traffic-left)_+_50px)]")}
      data-tab-row
      data-tauri-drag-region
      onValueChange={(id) => showTab(leaf.id, String(id))}
      value={leaf.active}
    >
      {/* The underline is left out: the front tab reads by its colour alone. */}
      <TabsList className="min-w-0 *:data-[slot=tab-indicator]:hidden" variant="underline">
        {leaf.tabs.map((t) => (
          <TabItem key={t.id} pane={leaf.id} tab={t} />
        ))}
      </TabsList>
      <KeyButton id="new-tab" label="New tab" onClick={() => newTab(leaf.id)}>
        <Plus className="size-4" />
      </KeyButton>
    </Tabs>
  );
}

function TabItem({ pane, tab }: { pane: string; tab: Tab }) {
  const page = pageIn(tab);
  const shown = describe(page);
  return (
    <TabsTab
      className="group/tab w-44 min-w-0 shrink grow-0 justify-start pe-1"
      data-tab
      nativeButton={false}
      onPointerDown={(e) => armDrag(e, { page, label: shown.title, tab: tab.id })}
      render={<div />}
      value={tab.id}
    >
      <RowIcon icon={shown.icon} />
      <span className="min-w-0 flex-1 truncate">{shown.title}</span>
      <Button
        aria-label="Close tab"
        className="opacity-0 transition-opacity duration-150 ease-out focus-visible:opacity-100 group-hover/tab:opacity-100"
        onClick={(e) => {
          e.stopPropagation(); // closing a tab doesn't bring it to the front first
          closeTab(pane, tab.id);
        }}
        size="icon-xs"
        variant="ghost"
      >
        <X className="size-4" />
      </Button>
    </TabsTab>
  );
}

// What an empty tab shows, and the window with no page open.
export function NoPage({ className }: { className?: string }) {
  const create = () => void newPage(PAGE_TYPE).then((obj) => openPage(obj.id), console.error);
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>No page open</EmptyTitle>
        <EmptyDescription>Create a page to start writing.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={create}>
          <Plus />
          New page
        </Button>
      </EmptyContent>
    </Empty>
  );
}
