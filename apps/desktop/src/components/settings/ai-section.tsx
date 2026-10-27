import { ChevronDown, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "@/views/settings/controls";
import { closeSettings } from "@/views/settings/open";
import { Code, SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Switch } from "@leadinglight/ui/components/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { toastManager } from "@leadinglight/ui/components/toast";
import { type AgentStatus, agentStatus } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents, showAgentsFolder } from "~/lib/agents";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectPrimitive } from "@leadinglight/ui/components/select";
import { ACCESS, EFFORTS, GPT_ACCESS, isClaude, labelOf, MODELS, setAiPrefs, setTailPrefs, type TailPrefs, tailPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { codex, effortFor, effortsFor, loadCodex } from "~/lib/codex";
import { closeUpdateToast } from "~/components/cli-updates";
import { TypeChoices, UseSuggestions } from "~/components/settings/writing-section";
import { behind, cliPrefs, commandOf, INSTALL, loadTools, SOURCE, type Tool, tools, updateTool } from "~/lib/clis";
import { openLink } from "~/lib/links";
import { isNative } from "~/lib/platform";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { type RuntimeStatus, runtimeStatus } from "~/lib/project-runtime/transport";
import { space } from "~/lib/space";
import { beat, lastBeat, openAbout, readsOn, readsOnByDefault } from "~/lib/tail";
import { ABOUT } from "~/lib/tail-memory";

// Settings › AI: the Claude Code sign-in the answers come through, and how they are asked.
export function AiSection() {
  const prefs = useAiPrefs();
  // The Effort rows read Codex's list, which comes in after the page opens.
  codex.use();
  const [status, setStatus] = useState<AgentStatus | "checking">("checking");
  const check = () => {
    setStatus("checking");
    void agentStatus().then(setStatus);
  };
  useEffect(check, []);
  const [agents, setAgents] = useState<Agent[]>(BUILT_IN);
  const [native, setNative] = useState(false);
  useEffect(() => {
    void listAgents(true).then(setAgents);
    void isNative.then(setNative);
  }, []);

  return (
    <SettingsPage title="AI" description="Claude through Claude Code, and GPT through Codex, both on this Mac. There is no key to enter.">
      <SettingsGroup title="Account">
        <SettingsRow label="Claude Code" description={<Account status={status} />}>
          <Button onClick={check} size="sm" variant="outline">
            Check again
          </Button>
        </SettingsRow>
        <SettingsRow label="Codex" description={<CodexAccount />}>
          <Button onClick={() => void loadCodex(true)} size="sm" variant="outline">
            Check again
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <CliTools />
      <RuntimeGroup />
      <SettingsGroup title="Answers">
        <SettingsRow label="Model" description="Claude's through Claude Code; GPT's through Codex.">
          <ModelSelect onChange={(model) => setAiPrefs({ model, effort: effortFor(model, prefs.effort) })} value={prefs.model} />
        </SettingsRow>
        <SettingsRow label="Effort" description="How long the model thinks before answering.">
          <Segmented
            value={effortFor(prefs.model, prefs.effort)}
            options={effortsFor(prefs.model).map((value) => ({ value, label: labelOf(EFFORTS, value) }))}
            onChange={(effort) => setAiPrefs({ effort })}
          />
        </SettingsRow>
        <SettingsRow label="Access" description={isClaude(prefs.model) ? ACCESS.find((a) => a.value === prefs.access)?.description : GPT_ACCESS[prefs.access]}>
          <Segmented value={prefs.access} options={ACCESS} onChange={(access) => setAiPrefs({ access })} />
        </SettingsRow>
      </SettingsGroup>
      <TailGroup />
      <SettingsGroup
        title="Agents"
        description="Mention one with @ in the panel. Each is a Claude Code agent file: name, description and model in its front matter, the prompt below. Yours go in the app's agents folder or ~/.claude/agents."
        actions={
          native ? (
            <Button onClick={() => void showAgentsFolder()} size="sm" variant="outline">
              Show folder
            </Button>
          ) : undefined
        }
      >
        {agents.map((a) => (
          <SettingsRow description={a.description ?? undefined} key={a.id} label={a.name}>
            <span className="max-w-64 truncate text-xs text-muted-foreground" title={a.source}>
              {a.source === "Built in" ? "Built in" : a.source.replace(/^.*\//, "")}
              {a.model ? ` · ${a.model}` : ""}
            </span>
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SettingsGroup title="Privacy">
        <SettingsRow label="What leaves this Mac" description="Notes stay here. Only your question, the page you ask from, and pages the model reads or you mention leave this Mac, and only when you ask: to Anthropic for Claude, to OpenAI for GPT. In a project chat, the agent also reads files in the folder you linked as it works, and what it reads goes to them too. Tail, unasked, sends the titles of your pages, and the summaries and changed words of those it reads on." />
      </SettingsGroup>
    </SettingsPage>
  );
}

function Account({ status }: { status: AgentStatus | "checking" }) {
  if (status === "checking") return <>Checking…</>;
  if (!status.installed)
    return (
      <>
        Not installed. Get it from{" "}
        <button className="underline" onClick={() => openLink("https://claude.com/code")} type="button">
          claude.com/code
        </button>
        , then sign in with <Code>claude auth login</Code> in Terminal.
      </>
    );
  if (!status.logged_in)
    return (
      <>
        Installed{status.version ? ` (${status.version})` : ""} but not signed in. Run <Code>claude auth login</Code> in Terminal, then check again.
        {status.error ? ` ${status.error}` : ""}
      </>
    );
  return (
    <>
      Signed in as {status.email ?? "you"}
      {status.plan ? ` · ${status.plan}` : ""}
      {status.version ? ` · ${status.version}` : ""}
    </>
  );
}

// The project runtime project chats run in (DECISIONS.md, 18): whether it runs, and a restart,
// which its agents outlive.
function RuntimeGroup() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { enabled } = projectPrefs.use();
  useEffect(() => void runtimeStatus().then(setStatus), []);
  const start = () => {
    setBusy(true);
    void runtimeStatus({ start: true, restart: status?.state === "ready" })
      .then(setStatus)
      .finally(() => setBusy(false));
  };
  const what = busy && status?.state === "ready"
    ? "Restarting…"
    : !status
    ? "Checking…"
    : status.state === "ready"
      ? `Running, ${status.version}. Agents in project chats keep working while the app is closed.`
      : status.state === "failed"
        ? `Not running: ${status.error}`
        : "Starts when a project chat first needs it.";
  return (
    <SettingsGroup title="Projects">
      <SettingsRow label="Linked folders and project chats" description="In development: link a page to a folder on this Mac, and chat with an agent working in it.">
        <Switch checked={enabled} onCheckedChange={(on) => projectPrefs.set({ enabled: on })} />
      </SettingsRow>
      <SettingsRow
        label="Runtime"
        description={
          <>
            {what}
            {status?.home && (
              <>
                {" "}
                Its state is in <Code>{status.home}</Code>
              </>
            )}
          </>
        }
      >
        <Button disabled={busy || !status} onClick={start} size="sm" variant="outline">
          {busy && <Spinner />}
          {status?.state === "ready" ? "Restart" : "Start"}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

// The Claude Code and Codex on this Mac, each with its version, where it came from, and Update.
function CliTools() {
  const list = tools.use();
  const prefs = cliPrefs.use();
  useEffect(() => void loadTools(), []);
  const update = (t: Tool) =>
    updateTool(t.id)
      .then(() => {
        if (!tools.get().some(behind)) closeUpdateToast();
        toastManager.add({ type: "success", title: `${t.name} update finished`, timeout: 6000 });
      })
      .catch((e: Error) => toastManager.add({ type: "error", title: `Couldn't update ${t.name}`, description: e.message }));
  return (
    <SettingsGroup title="Command-line tools" description="Claude Code and Codex on this Mac, found as Terminal finds them.">
      <SettingsRow label="Check for updates" description="Look for newer versions in the background, and say when there are.">
        <Switch checked={prefs.check} onCheckedChange={(check) => cliPrefs.set({ check })} />
      </SettingsRow>
      {list.map((t) => (
        <SettingsRow
          description={
            t.path ? (
              <span title={t.path}>
                {t.version ?? "Unknown version"} · {t.source ? SOURCE[t.source] : ""}
              </span>
            ) : (
              <>
                Not installed.{" "}
                <button className="underline" onClick={() => openLink(INSTALL[t.id])} type="button">
                  How to install it
                </button>
              </>
            )
          }
          key={t.id}
          label={t.name}
        >
          {t.path && <span className="text-muted-foreground text-xs">{status(t)}</span>}
          {/* Update shows where it can help: behind, failed, unknown, or self-updating. */}
          {t.path &&
            (!t.command ? (
              <span className="text-muted-foreground text-xs">Manual update</span>
            ) : behind(t) || t.error || !t.latest || t.source === "native" ? (
              <Tooltip>
                <TooltipTrigger
                  render={<Button aria-label={`Update ${t.name}`} disabled={t.updating} onClick={() => void update(t)} size="sm" variant="outline" />}
                >
                  {t.updating ? <Spinner /> : <Download />}
                  {t.updating ? "Updating" : "Update"}
                </TooltipTrigger>
                <TooltipPopup>Runs {commandOf(t)}</TooltipPopup>
              </Tooltip>
            ) : null)}
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

function status(t: Tool) {
  if (t.error) return <span title={t.error}>Update failed</span>;
  if (t.source === "native") return "Updates itself";
  if (behind(t)) return `${t.version} → ${t.latest}`;
  return t.latest ? `Current ${t.version}` : "";
}

function CodexAccount() {
  const cx = codex.use();
  useEffect(() => void loadCodex(), []);
  if (cx.state === "checking") return <>Checking…</>;
  if (cx.state === "missing")
    return (
      <>
        Not installed. Get it from{" "}
        <button className="underline" onClick={() => openLink(INSTALL.codex)} type="button">
          OpenAI
        </button>{" "}
        for GPT models, then sign in with <Code>codex login</Code> in Terminal.
      </>
    );
  if (cx.state === "signed-out") return <>Installed but not signed in. Run <Code>codex login</Code> in Terminal, then check again.</>;
  return (
    <>
      Signed in as {cx.email ?? "you"}
      {cx.plan ? ` · ${cx.plan}` : ""} · {cx.models.length} GPT models
    </>
  );
}

const MODES: { value: TailPrefs["mode"]; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "Nothing from tail shows anywhere, and no beat runs." },
  { value: "quiet", label: "Quiet", description: "Today's lines and where you stopped on a page; no chip beside a line, no guess in the capture box." },
  { value: "normal", label: "Normal", description: "Today's lines, where you stopped, a chip beside the line you wrote, and the capture box's guess." },
];
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

// Settings › AI › Tail (docs/TAIL.md). Its last beat is all the Mac app shows of it, so it says
// when that ran and what came of it, or why it didn't go.
function TailGroup() {
  useAiPrefs();
  const t = tailPrefs();
  const types = space.use().types.filter((x) => x.id !== ABOUT);
  const last = lastBeat.use();
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    void beat().finally(() => setRunning(false));
  };
  // Only what differs from the suggestion is kept, as in Writing.
  const readOn = (ids: string[]) => setTailPrefs({ readsOn: Object.fromEntries(types.filter((x) => ids.includes(x.id) !== readsOnByDefault(x.id)).map((x) => [x.id, ids.includes(x.id)])) });
  const lines = (n: number) => (n ? `${n} ${n === 1 ? "line" : "lines"}` : "nothing to show");
  return (
    <SettingsGroup title="Tail" description="Reads along and offers one line you can nod at. It never asks, and never writes into your words until you nod.">
      <SettingsRow label="Offers" description={MODES.find((m) => m.value === t.mode)?.description}>
        <Segmented value={t.mode} options={MODES} onChange={(mode) => setTailPrefs({ mode })} />
      </SettingsRow>
      <SettingsRow label="Model" description="Claude's through Claude Code; GPT's through Codex.">
        <ModelSelect onChange={(model) => setTailPrefs({ model, effort: effortFor(model, t.effort) })} value={t.model} />
      </SettingsRow>
      <SettingsRow label="Effort" description="How long the model thinks before answering.">
        <Segmented value={effortFor(t.model, t.effort)} options={effortsFor(t.model).map((value) => ({ value, label: labelOf(EFFORTS, value) }))} onChange={(effort) => setTailPrefs({ effort })} />
      </SettingsRow>
      <SettingsRow
        className="flex-col items-stretch gap-3"
        description={
          <>
            Tail reads the summaries and words of these; the titles of all pages, so a name can still be linked. Suggested: as Writing's, and tasks.{" "}
            {Object.keys(t.readsOn).length > 0 && <UseSuggestions onClick={() => setTailPrefs({ readsOn: {} })} />}
          </>
        }
        label="Reads on"
      >
        <TypeChoices onChange={readOn} types={types} value={types.filter((x) => readsOn(x.id)).map((x) => x.id)} />
      </SettingsRow>
      <SettingsRow label="How you work" description="Dated sentences tail keeps about how you work, and reads at every turn. Edit or delete any; tail follows.">
        <Button
          onClick={() => {
            closeSettings();
            void openAbout();
          }}
          size="sm"
          variant="outline"
        >
          Open
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Last beat"
        description={t.mode === "off" ? "Tail is off." : !last ? "No beat yet." : last.error ? `Didn't go: ${last.error} (${clock.format(last.at)})` : `${clock.format(last.at)}, ${lines(last.lines)}`}
      >
        <Button disabled={running || t.mode === "off"} onClick={run} size="sm" variant="outline">
          {running && <Spinner />}
          Run now
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

// Every model, Claude's then GPT's, in one list.
function ModelSelect({ value, onChange }: { value: string; onChange(model: string): void }) {
  const cx = codex.use();
  const all = [...MODELS, ...cx.models.map((m) => ({ value: m.id, label: m.name }))];
  return (
    <Select items={Object.fromEntries(all.map((m) => [m.value, m.label]))} onValueChange={(v) => onChange(v as string)} value={value}>
      <SelectPrimitive.Trigger render={<Button size="sm" variant="outline" />}>
        {labelOf(all, value)}
        <ChevronDown className="size-3.5 opacity-60" />
      </SelectPrimitive.Trigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectGroupLabel>Claude</SelectGroupLabel>
          {MODELS.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectGroup>
        {cx.models.length > 0 && (
          <SelectGroup>
            <SelectGroupLabel>GPT</SelectGroupLabel>
            {cx.models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectPopup>
    </Select>
  );
}

