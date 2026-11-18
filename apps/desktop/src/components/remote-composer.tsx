import { ArrowUp, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Composer, ComposerActions, ComposerInput, ComposerSubmit, getComposerText, type ComposerValue } from "@leadinglight/ui/components/composer";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { MODELS } from "~/lib/ai-prefs";
import { BUILT_IN } from "~/lib/agents";

type Props = {
  text: string; onText: (value: string) => void; onSend: () => void;
  ready: boolean; busy: boolean; pending: boolean; started: boolean;
  agent: string; model: string; onAgent: (value: string) => void; onModel: (value: string) => void;
};

export function RemoteComposer({ text, onText, onSend, ready, busy, pending, started, agent, model, onAgent, onModel }: Props) {
  const value: ComposerValue = useMemo(() => text ? [{ type: "text", text }] : [], [text]);
  const locked = busy || pending;
  return <Composer value={value} onValueChange={(parts) => onText(getComposerText(parts))} onSubmit={onSend} readOnly={locked} submitDisabled={!ready || locked} className="[--composer-max-rows:4]">
    <ComposerInput aria-label="Message to agent" placeholder="Ask the agent to…" />
    <ComposerActions>
      <Popover>
        <PopoverTrigger render={<Button aria-label="Agent options" variant="ghost" size="icon-sm" disabled={locked} />}><SlidersHorizontal /></PopoverTrigger>
        <PopoverPopup className="w-64 space-y-3 p-3" side="top" align="start">
          <Field><FieldLabel>Agent</FieldLabel>
            <Select value={agent} onValueChange={(v) => v && onAgent(v)} disabled={started}><SelectTrigger aria-label="Agent"><SelectValue>{agent === "codex" ? "Codex" : "Claude Code"}</SelectValue></SelectTrigger>
              <SelectPopup><SelectItem value="claude">Claude Code</SelectItem><SelectItem value="codex">Codex</SelectItem></SelectPopup>
            </Select>
          </Field>
          <Field><FieldLabel>Model on the Mac</FieldLabel>{agent === "claude" ? <Select value={model || "default"} disabled={started} onValueChange={(v) => onModel(!v || v === "default" ? "" : v)}>
            <SelectTrigger aria-label="Model on the Mac"><SelectValue>{MODELS.find((m) => m.value === model)?.label || model || "Agent default"}</SelectValue></SelectTrigger>
            <SelectPopup><SelectItem value="default">Agent default</SelectItem>{MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectPopup>
          </Select> : <Input placeholder="Use the agent’s default" value={model} disabled={started} onChange={(e) => onModel(e.target.value.trim())} />}</Field>
          <Field><FieldLabel>Insert a prompt</FieldLabel>
            <Select value={null} onValueChange={(id) => {
              const prompt = BUILT_IN.find((p) => p.id === id)?.prompt;
              if (prompt) onText([prompt, text].filter(Boolean).join("\n\n"));
            }}><SelectTrigger aria-label="Insert a prompt"><SelectValue placeholder="Choose a prompt" /></SelectTrigger>
              <SelectPopup>{BUILT_IN.map((p) => <SelectItem value={p.id} key={p.id}>{p.name}</SelectItem>)}</SelectPopup>
            </Select>
          </Field>
        </PopoverPopup>
      </Popover>
      {pending ? <Button className="ml-auto" size="sm" variant="outline" disabled={busy || !ready} onClick={onSend}><RefreshCw />{busy ? "Sending…" : "Check and retry"}</Button> :
        <ComposerSubmit render={<Button className="ml-auto rounded-full" size="icon-sm" aria-label="Send" />}><ArrowUp /></ComposerSubmit>}
    </ComposerActions>
  </Composer>;
}
