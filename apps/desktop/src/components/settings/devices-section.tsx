import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Switch } from "@leadinglight/ui/components/switch";
import { toastManager } from "@leadinglight/ui/components/toast";
import { ConfirmDialog } from "@/views/settings/confirm";
import { MobileAgentsButton } from "~/components/mobile-agents";
import { connectMobileAgents, disconnectMobileAgents, mobileAgents, refreshMobileAgents } from "~/lib/mobile-agents";
import { useMobile } from "~/lib/platform";
import { folders, loadFolders } from "~/lib/project-runtime/folders";
import { ask } from "~/lib/project-runtime/transport";
import { cloudApi, useCloud } from "~/lib/cloud";
import { pageOf } from "~/lib/space";
import { mobileNotifications, refreshMobileNotifications, setMobileNotifications } from "~/lib/mobile-notifications";

type Host = { enabled: boolean; projects: string[]; code?: string; channel?: string; error?: string; name: string };
type Relay = { channel: string; hostToken: string; clientToken: string };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export function DevicesSection() {
  const mobile = useMobile();
  return <SettingsPage title="Devices" description="Run project agents on your Mac from iPhone or iPad with one encrypted connection.">
    {mobile ? <ConnectMac /> : <ShareMac />}
  </SettingsPage>;
}

function ShareMac() {
  const cloud = useCloud();
  const linked = folders.use();
  const [host, setHost] = useState<Host | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotate, setRotate] = useState(false);
  const read = () => {
    setBusy(true);
    void Promise.all([ask<Host>("GET", "/v1/mobile"), loadFolders()]).then(([value]) => { setHost(value); setError(""); }, (e) => setError(message(e))).finally(() => setBusy(false));
  };
  useEffect(read, []);
  const change = async (patch: Partial<Host> & { rotate?: boolean }) => {
    setBusy(true); setError("");
    let relay: Relay | undefined;
    const owner = cloud.user?.id;
    try {
      if (patch.enabled || patch.rotate) {
        if (!owner) throw new Error("Sign in on this Mac to enable mobile access.");
        relay = await cloudApi<Relay>("mobile-relay/channels", {}, "POST", owner);
      }
      setHost(await ask<Host>("PUT", "/v1/mobile", { ...patch, ...(relay ? { relay } : {}) }));
    }
    catch (e) {
      const current = await ask<Host>("GET", "/v1/mobile").catch(() => null);
      if (current) setHost(current);
      if (relay && current && current.channel !== relay.channel) await cloudApi("mobile-relay/remove", { channel: relay.channel }, "POST", owner).catch(() => {});
      setError(message(e));
    }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!host?.code) return;
    try { await navigator.clipboard.writeText(host.code); toastManager.add({ type: "success", title: "Connection code copied" }); }
    catch { setError("The code could not be copied. Allow clipboard access and try again."); }
  };
  return <>
    <SettingsGroup title="This Mac" description="Keep this Mac awake and online. LeadingLight carries encrypted messages between your devices. Your Claude Code and Codex accounts stay here.">
      {!cloud.user && <SettingsRow label="Connect your account" description="Sign in on this Mac to enable the connection. Your phone pairs with a code; note sync is optional."><Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new Event("leadinglight:cloud-account"))}>Account and sync</Button></SettingsRow>}
      <SettingsRow label="Mobile access" description={host?.error || (host?.enabled ? `Available on ${host.name}. Paired devices can start and answer agents in the projects below.` : "Off until you enable it and choose projects to share.")}>
        <Switch checked={host?.enabled ?? false} disabled={busy || !host || (!host.enabled && (!cloud.user || !host.projects.length))} onCheckedChange={(enabled) => void change({ enabled })} />
      </SettingsRow>
      <SettingsRow label="Connection code" description="Anyone with this code can control agents in shared projects. Replacing it disconnects every paired device.">
        <Button size="sm" variant="outline" disabled={busy || !host?.enabled || !host.code} onClick={() => void copy()}><Copy />Copy code</Button>
      </SettingsRow>
      {host?.enabled && <SettingsRow label="Replace connection code" description="Running agents keep working on this Mac. Devices need the new code to reconnect.">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRotate(true)}>Replace code…</Button>
      </SettingsRow>}
    </SettingsGroup>
    <SettingsGroup title="Shared projects" description="Only linked folders you choose are available. New agents ask before changing files or running commands.">
      {[...linked.values()].map(({ folder }) => <SettingsRow key={folder.location} label={pageOf(folder.pageId)?.title || folder.path.split("/").at(-1) || folder.location} description={folder.path}>
        <Checkbox checked={host?.projects.includes(folder.location) ?? false} disabled={!host || busy} onCheckedChange={(on) => void change({ projects: on ? [...host!.projects, folder.location] : host!.projects.filter((p) => p !== folder.location) })} />
      </SettingsRow>)}
      {!linked.size && <p className="py-4 text-sm text-muted-foreground">Enable project chats in Settings → AI, then link a page to a folder on this Mac.</p>}
    </SettingsGroup>
    {(error || host?.error) && <p role="alert" className="break-words text-sm text-destructive-foreground">{error || host?.error}</p>}
    <Button size="sm" variant="outline" disabled={busy} onClick={read}><RefreshCw />Check connection</Button>
    <ConfirmDialog open={rotate} onOpenChange={setRotate} title="Replace connection code?" description="All paired phones and tablets will need the new code. Running work stays on this Mac." confirm="Replace code" onConfirm={() => change({ rotate: true })} />
  </>;
}

function ConnectMac() {
  const state = mobileAgents.use();
  const notifications = mobileNotifications.use();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void refreshMobileAgents().catch((e) => setError(message(e))); }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); setCode(""); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <>
    <SettingsGroup title="Connect a Mac" description="In LeadingLight on your Mac, open Settings → Devices, choose shared projects, enable mobile access and copy its code. Both devices only need LeadingLight and an internet connection.">
      <form className="space-y-3 py-4" onSubmit={(e) => { e.preventDefault(); void run(() => connectMobileAgents(code)); }}>
        <Field><FieldLabel>Mac connection code</FieldLabel><Input type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste connection code" /></Field>
        <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Connecting…" : "Connect Mac"}</Button>
      </form>
    </SettingsGroup>
    {state.connection && <SettingsGroup title="Connected Mac">
      <SettingsRow label={state.connection.name} description={state.online ? "Online. Agents run on this Mac and keep working when you close this app." : "Cannot reach this Mac. Keep the Mac awake and connected to the internet."}>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(disconnectMobileAgents)}>Disconnect</Button>
      </SettingsRow>
      <div className="py-4"><MobileAgentsButton /></div>
      <SettingsRow label="Agent notifications" description={notifications.registered ? "Alerts are enabled for permissions and questions. Details stay inside the app." : "Get a generic alert when an agent needs your response, including when this app is closed."}>
        <Switch aria-label="Agent notifications" checked={notifications.enabled} disabled={notifications.busy} onCheckedChange={(value) => void setMobileNotifications(value)} />
      </SettingsRow>
    </SettingsGroup>}
    {(notifications.error || notifications.cleanupError) && <div className="space-y-2 py-3"><p role="status" className="text-sm text-muted-foreground">{notifications.cleanupError || notifications.error}</p><Button size="sm" variant="outline" disabled={notifications.busy} onClick={() => void refreshMobileNotifications()}>Check notifications</Button></div>}
    {(error || state.error) && <p role="alert" className="break-words text-sm text-destructive-foreground">{error || state.error}</p>}
    <p className="text-sm text-muted-foreground">No mobile sign-in or note sync is needed. Agent processes and files stay on your Mac; Claude and Codex still contact their model providers.</p>
  </>;
}
