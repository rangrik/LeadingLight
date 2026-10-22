import { useEffect, useState } from "react";
import { Segmented } from "@/views/settings/controls";
import { Code, SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { type AgentStatus, agentStatus } from "~/lib/agent";
import { type Agent, BUILT_IN, listAgents, showAgentsFolder } from "~/lib/agents";
import { setAiPrefs, useAiPrefs } from "~/lib/ai-prefs";
import { openLink } from "~/lib/links";
import { isNative } from "~/lib/platform";

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
    <SettingsPage title="AI" description="Claude, through the Claude Code on this Mac. There is no key to enter.">
      <SettingsGroup title="Account">
        <SettingsRow label="Claude Code" description={<Account status={status} />}>
          <Button onClick={check} size="sm" variant="outline">
            Check again
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Answers">
        <SettingsRow label="Model" description="Opus thinks hardest; Haiku answers fastest.">
          <Segmented
            value={prefs.model}
            options={[
              { value: "opus", label: "Opus" },
              { value: "sonnet", label: "Sonnet" },
              { value: "haiku", label: "Haiku" },
            ]}
            onChange={(model) => setAiPrefs({ model })}
          />
        </SettingsRow>
        <SettingsRow label="Effort" description="How long Claude thinks before answering.">
          <Segmented
            value={prefs.effort}
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
            onChange={(effort) => setAiPrefs({ effort })}
          />
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
        <SettingsRow label="What leaves this Mac" description="Notes stay here. Only the selected words, the note's text and your question go to Anthropic, and only when you ask." />
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
