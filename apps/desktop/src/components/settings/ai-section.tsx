import { ChevronDown, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "@/views/settings/controls";
import { Code, SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Spinner } from "@leadinglight/ui/components/spinner";
import { Switch } from "@leadinglight/ui/components/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { toastManager } from "@leadinglight/ui/components/toast";
import { type AgentStatus, agentStatus } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents, showAgentsFolder } from "~/lib/agents";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectPrimitive } from "@leadinglight/ui/components/select";
import { ACCESS, EFFORTS, GPT_ACCESS, isClaude, labelOf, MODELS, setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { codex, effortFor, effortsFor, loadCodex } from "~/lib/codex";
import { closeUpdateToast } from "~/components/cli-updates";
import { behind, cliPrefs, commandOf, INSTALL, loadTools, SOURCE, type Tool, tools, updateTool } from "~/lib/clis";
import { openLink } from "~/lib/links";
import { isNative } from "~/lib/platform";
import { type RuntimeStatus, runtimeStatus } from "~/lib/project-runtime/transport";

// Settings › AI: the Claude Code sign-in the answers come through, and how they are asked.
export function AiSection() {
  const prefs = useAiPrefs();
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
          <ModelSelect />
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
        <SettingsRow label="What leaves this Mac" description="Notes stay here. Only your question, the page you ask from, and pages the model reads or you mention leave this Mac, and only when you ask: to Anthropic for Claude, to OpenAI for GPT." />
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

// Every model, Claude's then GPT's, in one list.
function ModelSelect() {
  const prefs = useAiPrefs();
  const cx = codex.use();
  const all = [...MODELS, ...cx.models.map((m) => ({ value: m.id, label: m.name }))];
  return (
    <Select items={Object.fromEntries(all.map((m) => [m.value, m.label]))} onValueChange={(v) => setAiPrefs({ model: v as string, effort: effortFor(v as string, prefs.effort) })} value={prefs.model}>
      <SelectPrimitive.Trigger render={<Button size="sm" variant="outline" />}>
        {labelOf(all, prefs.model)}
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

