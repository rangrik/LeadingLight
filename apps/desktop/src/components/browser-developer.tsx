import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SettingsGroup, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Switch } from "@leadinglight/ui/components/switch";
import { Table, TableBody, TableCell, TableRow } from "@leadinglight/ui/components/table";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { ask } from "~/lib/project-runtime/transport";

type Status = { enabled: boolean; state: "disabled" | "none" | "pending" | "allowed" | "denied"; id?: string; origin?: string; reason?: string; expires?: string; text: string };
type DeveloperEvent = { sequence: number; method: string; params: Record<string, unknown>; truncated?: boolean };
type Events = { events: DeveloperEvent[]; sequence: number; dropped: number };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const route = (base: string, tab: string, suffix = "") => `${base}/developer${suffix}?tab=${encodeURIComponent(tab)}`;

function useDeveloperState(base: string, tab: string) {
  const [result, setResult] = useState<{ key: string; state?: Status; error?: string }>({ key: "" });
  const [revision, update] = useState(0);
  const key = `${base}/${tab}`;
  useEffect(() => {
    let live = true;
    let timer = 0;
    const read = async () => {
      try {
        const state = await ask<Status>("GET", route(base, tab));
        if (live) setResult({ key, state });
      } catch (error) { if (live) setResult({ key, error: errorText(error) }); }
      if (live) timer = window.setTimeout(read, 1000);
    };
    if (tab) void read();
    return () => { live = false; window.clearTimeout(timer); };
  }, [base, key, revision, tab]);
  return { state: result.key === key ? result.state : undefined, error: result.key === key ? result.error : undefined, refresh: () => update((n) => n + 1) };
}

export function BrowserDeveloperSetting() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void ask<{ enabled: boolean }>("GET", "/v1/browser/developer").then((value) => { if (live.current) setEnabled(value.enabled); }).catch((e) => { if (live.current) setError(errorText(e)); }).finally(() => { if (live.current) setBusy(false); });
    return () => { live.current = false; };
  }, []);
  const toggle = async (next: boolean) => {
    setBusy(true); setError("");
    try { const value = await ask<{ enabled: boolean }>("PUT", "/v1/browser/developer", { enabled: next }); if (live.current) setEnabled(value.enabled); }
    catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setBusy(false); }
  };
  return <SettingsGroup title="Developer tools">
    <SettingsRow label="Allow page developer access" description="Enables requests to inspect DOM, styles, network and performance through CDP. Each page still needs your approval. Turning this off revokes every grant.">
      <Switch aria-label="Allow page developer access" checked={enabled} disabled={busy} onCheckedChange={(next) => void toggle(next)} />
    </SettingsRow>
    {error && <p className="break-words px-3 py-2 text-sm text-destructive-foreground" role="alert">{error}</p>}
  </SettingsGroup>;
}

export function BrowserDeveloperNotice({ base, tab, onReview }: { base: string; tab: string; onReview: () => void }) {
  const { state } = useDeveloperState(base, tab);
  if (state?.state !== "pending") return null;
  return <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm" role="status"><p className="min-w-0 flex-1 break-words">Developer access requested for {state.origin}.</p><Button onClick={onReview} size="sm" variant="outline">Review access</Button></div>;
}

export function BrowserDeveloper(props: { base: string; tab: string; onClose: () => void }) {
  return <Developer key={`${props.base}/${props.tab}`} {...props} />;
}

function Developer({ base, tab, onClose }: { base: string; tab: string; onClose: () => void }) {
  const { state, error: stateError, refresh } = useDeveloperState(base, tab);
  const [reason, setReason] = useState("Inspect this page's layout and performance.");
  const [method, setMethod] = useState("DOM.getDocument");
  const [params, setParams] = useState('{"depth":2}');
  const [result, setResult] = useState("");
  const [events, setEvents] = useState<Events>({ events: [], sequence: 0, dropped: 0 });
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  const scope = useRef("");
  scope.current = state?.state === "allowed" ? state.id ?? "" : "";
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    setResult(""); setEvents({ events: [], sequence: 0, dropped: 0 });
    if (state?.state !== "allowed") return;
    let active = true;
    let timer = 0;
    const read = async () => {
      try { const value = await ask<Events>("GET", route(base, tab, "/events")); if (active) setEvents(value); }
      catch (e) { if (active) setError(errorText(e)); }
      if (active) timer = window.setTimeout(read, 1000);
    };
    void read();
    return () => { active = false; window.clearTimeout(timer); };
  }, [base, state?.id, state?.state, tab]);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); if (live.current) refresh(); }
    catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setBusy(false); }
  };
  const call = async (name: string, argumentsJSON: string) => {
    setResult("");
    const id = scope.current;
    if (!id) return;
    let argumentsValue: unknown;
    try { argumentsValue = JSON.parse(argumentsJSON); } catch { throw new Error("Parameters must be valid JSON."); }
    if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== "object") throw new Error("Parameters must be a JSON object.");
    const value = await ask<{ result: unknown }>("POST", route(base, tab, "/cdp"), { method: name, params: argumentsValue });
    if (live.current && scope.current === id) setResult(JSON.stringify(value.result, null, 2));
  };
  const preset = (name: string, value: string) => { setMethod(name); setParams(value); void act(() => call(name, value)); };
  const visibleEvents = events.events.filter((event) => `${event.method} ${JSON.stringify(event.params)}`.toLowerCase().includes(filter.toLowerCase()));

  return <section aria-label="Developer tools" className="flex min-h-0 min-w-0 flex-1 flex-col text-sm" data-testid="browser-developer">
    <div className="flex min-h-10 shrink-0 items-center gap-1 border-b px-2"><h3 className="min-w-0 flex-1 px-1 font-medium">Developer tools</h3><Tooltip><TooltipTrigger render={<Button aria-label="Refresh developer access" onClick={refresh} size="icon-sm" variant="ghost" />}><RefreshCw className="size-4" /></TooltipTrigger><TooltipPopup>Refresh access</TooltipPopup></Tooltip><Tooltip><TooltipTrigger render={<Button aria-label="Close developer tools" onClick={onClose} size="icon-sm" variant="ghost" />}><X className="size-4" /></TooltipTrigger><TooltipPopup>Return to page</TooltipPopup></Tooltip></div>
    <div className="min-h-0 space-y-3 overflow-auto p-3">
      {(error || stateError) && <p className="break-words text-destructive-foreground" role="alert">{error || stateError}</p>}
      {!state ? <p role="status">Checking developer access…</p> : <>
        <p className="break-words text-muted-foreground">{state.text}</p>
        {state.state === "disabled" && <p>Open Settings → Browser to enable page developer access.</p>}
        {(state.state === "none" || state.state === "denied") && <><Field><FieldLabel>Developer task</FieldLabel><Input disabled={busy} maxLength={1000} onChange={(event) => setReason(event.target.value)} value={reason} /></Field><Button disabled={busy || !reason.trim()} onClick={() => void act(async () => { await ask("POST", route(base, tab, "/request"), { reason }); })} size="sm" variant="outline">Request access</Button></>}
        {state.state === "pending" && <div className="space-y-2 rounded-md border p-3"><p className="break-all font-medium">{state.origin}</p><p className="whitespace-pre-wrap break-words">{state.reason}</p><p className="text-xs text-muted-foreground">CDP can read sensitive page data and change its contents. Approval covers this page for up to 15 minutes and ends on navigation. Browser profiles and local files are excluded.</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void act(async () => { await ask("POST", route(base, tab, "/decide"), { id: state.id, allow: true }); })} size="sm">Allow for this page</Button><Button disabled={busy} onClick={() => void act(async () => { await ask("POST", route(base, tab, "/decide"), { id: state.id, allow: false }); })} size="sm" variant="outline">Deny</Button></div></div>}
        {state.state === "allowed" && <>
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => preset("DOM.getDocument", '{"depth":2}')} size="xs" variant="outline">DOM</Button><Button disabled={busy} onClick={() => preset("Performance.getMetrics", "{}")} size="xs" variant="outline">Metrics</Button><Button disabled={busy} onClick={() => preset("Profiler.start", "{}")} size="xs" variant="outline">Start CPU profile</Button><Button disabled={busy} onClick={() => preset("Profiler.stop", "{}")} size="xs" variant="outline">Stop CPU profile</Button><Button disabled={busy} onClick={() => void act(async () => { await ask("DELETE", route(base, tab)); })} size="xs" variant="outline">Revoke access</Button></div>
          <p className="text-xs text-muted-foreground">Page-scoped CDP: DOM, CSS, Runtime, accessibility, CPU profiling and captured network responses. Results are limited to 1 MiB.</p>
          <Field><FieldLabel>CDP method</FieldLabel><Input disabled={busy} maxLength={100} onChange={(event) => setMethod(event.target.value)} value={method} /></Field>
          <Field><FieldLabel>JSON parameters</FieldLabel><Textarea className="font-mono text-xs" disabled={busy} maxLength={60000} onChange={(event) => setParams(event.target.value)} value={params} /></Field>
          <Button disabled={busy || !method.trim()} onClick={() => void act(() => call(method.trim(), params))} size="sm" variant="outline">Run command</Button>
          {result && <Field><FieldLabel>Command result</FieldLabel><Textarea aria-label="Command result" className="font-mono text-xs [&_textarea]:max-h-64" readOnly value={result} /></Field>}
          <Field><FieldLabel>Captured events</FieldLabel><Input aria-label="Filter developer events" onChange={(event) => setFilter(event.target.value)} placeholder="Filter console or network events…" size="sm" value={filter} /></Field>
          {events.dropped > 0 && <p className="text-xs text-muted-foreground">{events.dropped} older events dropped. The latest 256 events are retained, up to 1 MiB.</p>}
          {visibleEvents.length ? <Table className="table-fixed"><TableBody>{visibleEvents.map((event) => <TableRow key={event.sequence}><TableCell className="space-y-1 whitespace-normal leading-relaxed"><p className="break-all font-mono text-xs">{event.method}</p><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.params, null, 2)}</pre>{event.truncated && <p className="text-xs text-muted-foreground">Event shortened at 32 KiB.</p>}{event.method === "Network.loadingFinished" && typeof event.params.requestId === "string" && <Button disabled={busy} onClick={() => preset("Network.getResponseBody", JSON.stringify({ requestId: event.params.requestId }))} size="xs" variant="outline">Read response body</Button>}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-muted-foreground">No matching events captured.</p>}
        </>}
      </>}
    </div>
  </section>;
}
