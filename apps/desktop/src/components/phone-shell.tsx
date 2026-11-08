// COSS sidebar-08 lists and p-input-group-1, composed for one-handed navigation.
import { CalendarDays, ChevronRight, FileText, Inbox, PenLine, Plus, Search, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { openSettings } from "@/views/settings/open";
import { Button } from "@leadinglight/ui/components/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@leadinglight/ui/components/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@leadinglight/ui/components/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@leadinglight/ui/components/input-group";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@leadinglight/ui/components/sidebar";
import { CloudButton } from "~/components/cloud-settings";
import { MobileAgentsButton } from "~/components/mobile-agents";
import { RowIcon } from "~/components/page-icon";
import { PaneArea } from "~/components/pane-area";
import { captured, captureOf } from "~/lib/capture-inbox";
import { dayPage, dailyTitle, today } from "~/lib/daily";
import { pageLabel } from "~/lib/labels";
import { docText, objects, type ObjectSummary } from "~/lib/objects";
import { focusedPage, openPage, panes } from "~/lib/panes";
import { flushAll, reportSaveError } from "~/lib/saving";
import { iconFor, INBOX_VIEW, isPageView, pageOf, space, typeOf, typeView } from "~/lib/space";
import { ABOUT } from "~/lib/tail-memory";

type Screen = "today" | "notes" | "page";
const recent = (a: ObjectSummary, b: ObjectSummary) => b.updatedAt - a.updatedAt;
const visible = (page: ObjectSummary) => !page.properties.templateOf && page.typeId !== ABOUT;

function NoteRows({ pages, onOpen }: { pages: ObjectSummary[]; onOpen: (id: string) => void }) {
  return <SidebarMenu>{pages.map((page) => <SidebarMenuItem key={page.id}>
    <SidebarMenuButton className="h-auto min-h-14 px-3 py-2" onClick={() => onOpen(page.id)}>
      <RowIcon icon={iconFor(page)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base">{pageLabel(page.title)}</span>
        <span className="truncate text-xs text-muted-foreground">{typeOf(page.typeId).name}</span>
      </span>
      <ChevronRight className="text-muted-foreground" />
    </SidebarMenuButton>
  </SidebarMenuItem>)}</SidebarMenu>;
}

function PhoneNotes({ active, onOpen, onCreate }: { active: boolean; onOpen: (id: string) => void; onCreate: () => void }) {
  const { pages, types } = space.use();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(40);
  const needle = query.trim().toLocaleLowerCase();
  useEffect(() => {
    if (!active) return;
    let stale = false;
    setMatches([]);
    setError(false);
    setSearching(!!needle);
    setLimit(40);
    if (!needle) return;
    const timer = window.setTimeout(() => {
      void flushAll().then(() => objects.containing(needle)).then((found) => {
        if (!stale) setMatches(found.filter((p) => docText(p.content).toLocaleLowerCase().includes(needle)).map((p) => p.id));
      }).catch(() => { if (!stale) setError(true); }).finally(() => { if (!stale) setSearching(false); });
    }, 180);
    return () => { stale = true; clearTimeout(timer); };
  }, [needle, retry, active, pages]);
  const shown = pages.filter(visible).filter((p) => !needle || p.title.toLocaleLowerCase().includes(needle) || matches.includes(p.id)).sort(recent);
  return <>
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-3xl font-semibold tracking-tight">Notes</h1>
      <Button aria-label="New page" onClick={onCreate} size="icon" variant="outline"><Plus /></Button>
    </div>
    <InputGroup className="mt-5">
      <InputGroupInput aria-label="Search notes" autoComplete="off" onChange={(e) => setQuery(e.target.value)} placeholder="Search your words" type="search" value={query} />
      <InputGroupAddon><Search aria-hidden="true" className="size-4" /></InputGroupAddon>
      {query && <InputGroupAddon align="inline-end"><Button aria-label="Clear search" onClick={() => setQuery("")} size="icon" variant="ghost"><X /></Button></InputGroupAddon>}
    </InputGroup>
    {!needle && <div className="my-5 space-y-2">
      <Button className="w-full justify-start" onClick={() => onOpen(INBOX_VIEW)} variant="outline"><Inbox />Captures<ChevronRight className="ml-auto" /></Button>
      <MobileAgentsButton className="min-h-12 w-full justify-start" />
      <Collapsible>
        <CollapsibleTrigger render={<Button className="w-full justify-start" variant="ghost" />}><FileText />Browse by type</CollapsibleTrigger>
        <CollapsiblePanel><SidebarMenu>{types.filter((t) => !t.made || pages.some((p) => p.typeId === t.id)).map((type) => <SidebarMenuItem key={type.id}>
          <SidebarMenuButton onClick={() => onOpen(typeView(type.id))}><RowIcon icon={type.icon} /><span>{type.plural}</span></SidebarMenuButton>
        </SidebarMenuItem>)}</SidebarMenu></CollapsiblePanel>
      </Collapsible>
    </div>}
    <h2 className="mt-6 mb-2 text-sm font-medium text-muted-foreground">{needle ? "Search results" : "Recent notes"}</h2>
    {searching && <p className="py-3 text-sm text-muted-foreground" role="status">Searching your notes…</p>}
    {error && <div className="py-3 text-sm" role="alert">Couldn’t search the text of your notes. <Button onClick={() => setRetry(retry + 1)} variant="ghost">Try again</Button></div>}
    <NoteRows onOpen={onOpen} pages={shown.slice(0, limit)} />
    {!shown.length && !searching && !error && <Empty className="px-0 py-8"><EmptyHeader>
      <EmptyTitle>{needle ? "No notes found" : "Your notes will be here"}</EmptyTitle>
      <EmptyDescription>{needle ? "Try another word or clear the search." : "Capture a thought or start a new page. You can organize it later."}</EmptyDescription>
    </EmptyHeader></Empty>}
    {shown.length > limit && <Button className="mt-3 w-full" onClick={() => setLimit(limit + 40)} variant="outline">Show more notes</Button>}
    {!needle && <div className="mt-8 border-t pt-4"><CloudButton /></div>}
  </>;
}

export function PhoneShell({ loaded, onCapture, onCreate }: { loaded: boolean; onCapture: () => void; onCreate: () => void }) {
  const { pages } = space.use();
  const { root } = panes.use();
  const [screen, setScreen] = useState<Screen>("today");
  const [day, setDay] = useState(today);
  const [last, setLast] = useState(() => localStorage.getItem("ll.phone.last") ?? "");
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let previous = focusedPage();
    return panes.subscribe(() => {
      const current = focusedPage();
      if (current === previous) return;
      previous = current;
      if (!current) return setScreen("today");
      setScreen("page");
      if (isPageView(current)) {
        setLast(current);
        try { localStorage.setItem("ll.phone.last", current); } catch { /* The note itself is still saved. */ }
      }
    });
  }, [loaded]);
  const open = (id: string) => { openPage(id); setScreen("page"); };
  const navigate = (next: Screen) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void flushAll().catch(reportSaveError);
    setScreen(next);
  };
  const resume = pageOf(last) ?? pages.filter(visible).sort(recent)[0];
  const captures = captured(pages).sort((a, b) => captureOf(b)!.capturedAt - captureOf(a)!.capturedAt).slice(0, 3);
  return <div className="ll-phone flex min-h-0 min-w-0 flex-1 flex-col bg-background" style={{ "--header-height": "52px" } as React.CSSProperties}>
    <div className="relative flex min-h-0 flex-1 flex-col">
    {screen !== "page" && <header className="flex h-14 shrink-0 items-center justify-between px-5">
      <span className="text-sm font-medium text-muted-foreground">LeadingLight</span>
      <Button aria-label="Settings" onClick={() => openSettings()} size="icon" variant="ghost"><Settings /></Button>
    </header>}
    {screen === "today" && <main aria-label="Today" className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
      <p className="mt-1 text-sm text-muted-foreground">{dailyTitle(day)}</p>
      <Button className="mt-7 min-h-12 w-full" disabled={!loaded} onClick={onCapture}><Plus />Capture a thought</Button>
      <p className="mt-2 text-center text-sm text-muted-foreground">Get it down. Sort it out later.</p>
      <section aria-label="Pick up where you left off" className="mt-8 space-y-3">
        {resume && <Button aria-label="Continue writing" className="h-auto min-h-16 w-full justify-start px-3 py-3" onClick={() => open(resume.id)} variant="outline">
          <PenLine /><span className="min-w-0 flex-1 text-left"><span className="block text-sm text-muted-foreground">Continue writing</span><span className="block truncate">{pageLabel(resume.title)}</span></span><ChevronRight />
        </Button>}
        <Button className="min-h-12 w-full justify-start" disabled={!loaded} onClick={() => void dayPage(day).then(open).catch(reportSaveError)} variant="outline"><CalendarDays />Write about today<ChevronRight className="ml-auto" /></Button>
      </section>
      {!!captures.length && <section aria-label="Recent captures" className="mt-8">
        <div className="mb-1 flex items-center justify-between gap-2"><h2 className="text-sm font-medium text-muted-foreground">Recent captures</h2><Button onClick={() => open(INBOX_VIEW)} variant="ghost">See all</Button></div>
        <NoteRows onOpen={open} pages={captures} />
      </section>}
      {!loaded && <p className="mt-5 text-sm text-muted-foreground" role="status">Opening your notes…</p>}
    </main>}
    <main aria-label="Notes" className={screen === "notes" ? "min-h-0 flex-1 overflow-y-auto px-5 pb-6" : "hidden"} inert={screen !== "notes" || undefined}>
      <PhoneNotes active={screen === "notes"} onCreate={onCreate} onOpen={open} />
    </main>
    {/* WebKit loses scroll when display:none gives the editor a zero-height pane. */}
    <div className={`absolute inset-0 flex ${screen === "page" ? "" : "invisible pointer-events-none"}`} inert={screen !== "page" || undefined}>
      {root && <PaneArea lead={false} windowToggle={false} />}
    </div>
    </div>
    <nav aria-label="Phone navigation" className="grid shrink-0 grid-cols-3 items-center gap-2 border-t bg-background px-4 py-2">
      <Button aria-current={screen === "today" ? "page" : undefined} className="h-12 flex-col gap-0.5 text-xs" onClick={() => navigate("today")} variant={screen === "today" ? "secondary" : "ghost"}><CalendarDays />Today</Button>
      <Button aria-label="Quick capture" className="h-12 flex-col gap-0.5 text-xs" data-quick-capture disabled={!loaded} onClick={onCapture}><Plus />Capture</Button>
      <Button aria-current={screen === "notes" ? "page" : undefined} className="h-12 flex-col gap-0.5 text-xs" onClick={() => navigate("notes")} variant={screen === "notes" ? "secondary" : "ghost"}><FileText />Notes</Button>
    </nav>
  </div>;
}
