import { PublishedPages } from '~/components/published-pages';
import { Copy, Laptop, Plus, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/views/settings/confirm";
import { SettingsGroup, SettingsPage, SettingsRow } from "@/views/settings/rows";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { Input } from "@leadinglight/ui/components/input";
import { Label } from "@leadinglight/ui/components/label";
import { Switch } from "@leadinglight/ui/components/switch";
import { toastManager } from "@leadinglight/ui/components/toast";
import { AddDeviceDialog } from "~/components/add-device";
import { PairingSettings } from "~/components/pairing-settings";
import { MobileAgentAccess } from "~/components/settings/devices-section";
import { accountLine, cloudApi, signIn, signOut, useCloud } from "~/lib/cloud";
import { type Device, devices, nameDevice, refreshDevices, removeDevice } from "~/lib/devices";
import { formatAgo } from "~/lib/format";
import { cancelNativeConnection, nativeConnection, openNativeApproval } from "~/lib/native-account";
import { phone, platform, useMobile } from "~/lib/platform";
import { disableSync, enableSync, keySavedName, syncEnabled, syncKey, syncNow } from "~/lib/sync";

const KIND = { mac: Laptop, ipad: Tablet, iphone: Smartphone };
// The default names say "LeadingLight on Mac"; this list is already LeadingLight's.
const short = (name: string) => name.replace(/^LeadingLight on /, "");
const online = (d: Device) => !d.lastSeen
  ? `Joined ${new Date(d.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
  : Date.now() - Date.parse(d.lastSeen) < 600_000 ? "Online now" : `Last online ${formatAgo(Date.parse(d.lastSeen))}`;

// Settings › Account and devices: who is signed in, sync, the devices on the account, and the recovery key.
export function AccountSection() {
  const cloud = useCloud(), os = platform.use(), native = os !== "browser", mobile = useMobile();
  const list = devices.use(), connection = nativeConnection.use();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<string>(), [keyError, setKeyError] = useState("");
  const [open, setOpen] = useState<"" | "add" | "key" | "out" | "all" | "name">(""), [removing, setRemoving] = useState<Device>();
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const { user, known } = cloud, bound = localStorage.getItem("leadinglight.sync-owner");
  const key = syncKey(), syncing = Boolean(key) && syncEnabled(), wrong = Boolean(user && bound && bound !== user.id);
  const here = native ? (os === "macos" ? "This Mac" : phone ? "This iPhone" : "This iPad") : "This browser", it = here.replace("This", "this");
  const owner = user?.id ?? bound ?? "", saved = localStorage.getItem(keySavedName(owner)) === "true";
  // Signed out with an account on record: the sign-in ended, or the service cannot be reached.
  const away = !user && known && !known.left && !cloud.ended, mismatch = cloud.error.startsWith("The recovery key does not match");
  // A device joins a moment after it is approved, so the list is read again while this page is open.
  const load = () => void refreshDevices().catch(() => undefined);
  useEffect(() => {
    if (!user) return devices.set(null);
    load(); const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const turnOn = () => run(async () => {
    setKeyError("");
    try { await enableSync(recovery); } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // An account that already syncs needs its key: ask for it here, and say what is wrong with it here.
      if (recovery === undefined && message.startsWith("This account already has synced notes")) return setRecovery("");
      if (recovery === undefined) throw e;
      return setKeyError(message);
    }
    // A key made here has to be saved; a pasted one came from where it is already kept.
    if (!key && !recovery) setOpen("key"); else if (recovery && user) localStorage.setItem(keySavedName(user.id), "true");
    setRecovery(undefined);
    await syncNow();
  });
  // This device first, then the order the service gives: most recently online.
  const rows = list && [...list].sort((a, b) => Number(b.current) - Number(a.current));
  // Offline is a state, not a fault, so it is not shown in red.
  const quiet = /^(You’re offline|Cloud could not be reached)/.test(cloud.error);
  const connect = () => run(async () => {
    await signIn("");
    if (nativeConnection.get().message) toastManager.add({ type: "success", title: "Connected", description: "Your notes are syncing with this account." });
  });

  return (
    <SettingsPage title="Account and devices" description="Your notes stay on this device. Sign in to keep them on your other devices too, locked with a key that only your devices hold.">
      {(error || (user && cloud.error && !mismatch && !quiet)) && <Alert variant="error"><AlertDescription>{error || cloud.error}</AlertDescription></Alert>}
      {!error && user && quiet && <p className="text-muted-foreground text-sm" role="status">{cloud.error}</p>}
      {!cloud.initialized ? <p className="text-muted-foreground text-sm" role="status">Checking your account…</p> : user ? <>
        {wrong && <Alert variant="warning">
          <AlertTitle>These notes sync with {known?.id === bound ? accountLine(known) || known.name : "another account"}</AlertTitle>
          <AlertDescription>You are signed in as {accountLine(user) || user.name}. Sync stays off for these notes. Sign out, then sign in to the account they belong to.</AlertDescription>
        </Alert>}
        <SettingsGroup title="Account">
          <SettingsRow description={accountLine(user) || undefined} label={user.name}>
            <Button disabled={busy} onClick={() => setOpen("out")} size="sm" variant="outline">Sign out</Button>
          </SettingsRow>
        </SettingsGroup>

        {!wrong && <SettingsGroup title="Sync">
          {syncing && <SettingsRow description="Changes move in the background. If two devices change a page while offline, both versions are kept." label={cloud.sync}>
            <Button disabled={busy} onClick={() => void run(syncNow)} size="sm" variant="outline"><RefreshCw />Sync now</Button>
          </SettingsRow>}
          {key ? <SettingsRow description="Turn off to keep this device to itself for a while. Nothing is deleted." label={`Sync ${it}`}>
            <Switch checked={syncing} disabled={busy} onCheckedChange={(on) => { if (on) void run(async () => { await enableSync(); await syncNow(); }); else disableSync(); }} />
          </SettingsRow> : <SettingsRow className="max-sm:flex-wrap max-sm:gap-y-3" description="Turning it on makes a recovery key and keeps a locked copy of your notes for your other devices." label="Sync is off here">
            <Button disabled={busy || !cloud.config.allowed} onClick={() => void turnOn()}>Turn on sync</Button>
          </SettingsRow>}
          {(key ? mismatch : recovery !== undefined) && <Form className="space-y-3 py-4" onSubmit={(event) => { event.preventDefault(); void turnOn(); }}>
            <Field>
              <FieldLabel>Recovery key</FieldLabel>
              <Input autoComplete="off" onChange={(event) => setRecovery(event.target.value)} spellCheck={false} value={recovery ?? ""} />
              <FieldDescription>{mismatch ? cloud.error : "This account already has synced notes. On a device that syncs, open Account and devices, press Show… on Recovery key, and paste the key here."}</FieldDescription>
            </Field>
            {keyError && <p className="text-destructive-foreground text-sm" role="alert">{keyError}</p>}
            <Button disabled={busy || !recovery?.trim()} type="submit">{mismatch ? "Use this recovery key" : "Unlock notes"}</Button>
          </Form>}
          {!cloud.config.allowed && <p className="py-3 text-desc text-muted-foreground">Cloud access has not been enabled for this account yet.</p>}
        </SettingsGroup>}

        {!wrong && <div className="outline-none" id="account-devices" tabIndex={-1}><SettingsGroup actions={<Button disabled={!syncing || busy} onClick={() => setOpen("add")} size="sm"><Plus />Add a device</Button>} description="The apps signed in to this account. Browsers are not listed." title="Devices">
          {!syncing && <p className="py-3 text-desc text-muted-foreground">Turn on sync here to add another device.</p>}
          {rows?.map((d) => {
            const Icon = KIND[d.kind] ?? Laptop;
            return <SettingsRow description={online(d)} key={d.id} label={<span className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{short(d.name)}</span>
              {d.current && <Badge variant="outline">{here}</Badge>}
              {!d.current && Date.now() - Date.parse(d.createdAt) < 86_400_000 && <Badge variant="info">New</Badge>}
            </span>}>
              {d.current ? <Button onClick={() => setOpen("name")} size="sm" variant="outline">Rename</Button> : !native && <Button onClick={() => setRemoving(d)} size="sm" variant="outline">Remove</Button>}
            </SettingsRow>;
          })}
          {list?.length === 0 && <p className="py-4 text-muted-foreground text-sm">No app is signed in yet. On a Mac, iPad or iPhone, open LeadingLight, go to Settings, then Account and devices, and press Connect.</p>}
          {native
            ? <p className="py-3 text-desc text-muted-foreground">To remove a device, sign in at leadinglight.app.</p>
            : Boolean(list?.length) && <div className="py-3"><Button disabled={busy} onClick={() => setOpen("all")} size="sm" variant="outline">Sign out all devices</Button></div>}
        </SettingsGroup></div>}
      </> : away ? <>
        <SettingsGroup title="Account">
          <SettingsRow description={accountLine(known) || undefined} label={known.name} />
        </SettingsGroup>
        <p className="text-muted-foreground text-sm" role="status">{cloud.error || "Sync carries on when the service can be reached."}</p>
      </> : <>
        {cloud.ended && known && <Alert role="status" variant="warning">
          <AlertTitle>{here} is signed out of sync</AlertTitle>
          <AlertDescription>It was using {accountLine(known) || known.name}. Your notes are safe here, and changes will sync after you sign in.</AlertDescription>
        </Alert>}
        <SettingsGroup description={known && known.id === bound && !cloud.ended ? `These notes sync with ${accountLine(known) || known.name}.` : cloud.ended ? undefined : native ? "Connect to the account your other devices use." : "Use the account your other devices use. Google and GitHub are separate accounts, even with the same email."} title={cloud.ended ? "Sign in again" : "Sign in"}>
          {!native ? <div className="flex flex-wrap items-center gap-2 py-4">
            {cloud.config.providers.map((p) => <Button disabled={busy} key={p.id} onClick={() => void run(() => signIn(p.id))} variant="outline">
              Continue with {p.name}{localStorage.getItem("leadinglight.last-provider") === p.id && <Badge variant="secondary">Last used here</Badge>}
            </Button>)}
            {!cloud.config.providers.length && <p className="text-muted-foreground text-sm">{navigator.onLine ? "Cloud accounts are not configured in this installation yet." : "Sign-in is available when you are back online. Your local notes still work."}</p>}
          </div> : connection.pending ? <div className="space-y-3 py-4" role="status">
            {connection.code ? <>
              <p className="text-sm">Type this code in LeadingLight on a device that already syncs: Settings, Account and devices, Add a device.</p>
              <p className="rounded-lg bg-muted py-4 text-center font-mono font-semibold text-2xl tracking-[0.14em]">{connection.code.slice(0, 4)} {connection.code.slice(4)}</p>
              <p className="text-muted-foreground text-sm">Waiting. The code is good for 10 minutes. If this is your first device, or you only use the web so far, continue in the browser.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void openNativeApproval().catch((e) => setError(String(e)))} variant="outline">Continue in the browser</Button>
                <Button onClick={cancelNativeConnection} variant="ghost">Cancel</Button>
              </div>
            </> : <p className="text-muted-foreground text-sm">Getting a code…</p>}
          </div> : <SettingsRow className="max-sm:flex-wrap max-sm:gap-y-3" description="It shows a code to type on a device that already syncs. A first device continues in the browser." label={cloud.ended ? `Connect ${it} again` : `Connect ${it}`}>
            <Button disabled={busy || !cloud.config.ready} onClick={() => void connect()}>{cloud.ended ? "Sign in again" : `Connect ${it}`}</Button>
          </SettingsRow>}
        </SettingsGroup>
      </>}

      {key && <SettingsGroup title="Recovery key">
        <SettingsRow description="The only way back in if you lose every device. Keep it in a password manager." label={saved ? "Your key" : "Save your recovery key"}>
          <Button onClick={() => setOpen("key")} size="sm" variant={saved ? "outline" : "default"}>Show…</Button>
        </SettingsRow>
      </SettingsGroup>}

      {!mobile && <section className="space-y-3" id="account-agents">
        <h2 className="text-section text-foreground">Agents from a browser</h2>
        <PairingSettings />
      </section>}
      {user && <PublishedPages key={user.id} owner={user.id} />}
      <MobileAgentAccess />

      {user && <AddDeviceDialog account={user} onOpenChange={(next) => { setOpen(next ? "add" : ""); if (!next) load(); }} open={open === "add"} />}
      <KeyDialog onOpenChange={(next) => setOpen(next ? "key" : "")} open={open === "key"} owner={owner} saved={saved} value={key} />
      {list?.filter((d) => d.current).map((d) => <NameDialog device={d} it={it} key={d.id} onOpenChange={(next) => setOpen(next ? "name" : "")} open={open === "name"} />)}
      <ConfirmDialog confirm="Sign out" description="Your notes and the recovery key stay on this device. Sync stops until you sign in again." onConfirm={() => run(signOut)} onOpenChange={(next) => setOpen(next ? "out" : "")} open={open === "out"} title={`Sign out of ${it}?`} />
      <ConfirmDialog confirm="Sign out all devices" description={`Every Mac, iPad and iPhone app stops syncing until you connect it again. Notes stay on each device, and this browser stays signed in.${key ? "" : " Connecting the first device again needs your recovery key. Copy it from one of them first: Account and devices, Recovery key, Show…"}`} destructive onConfirm={() => run(async () => { await cloudApi("native/revoke-all", {}); await refreshDevices(); toastManager.add({ type: "success", title: "Every Mac, iPad and iPhone is signed out", description: "This browser stays signed in." }); })} onOpenChange={(next) => setOpen(next ? "all" : "")} open={open === "all"} title="Sign out all devices?" />
      <ConfirmDialog confirm={`Remove ${short(removing?.name ?? "")}`} description="It is signed out at once and gets nothing new. Notes already on it stay on it." destructive onConfirm={() => run(async () => { await removeDevice(removing!.id); document.getElementById("account-devices")?.focus(); })} onOpenChange={(next) => { if (!next) setRemoving(undefined); }} open={Boolean(removing)} title={`Remove ${short(removing?.name ?? "")}?`} />
    </SettingsPage>
  );
}

// The whole key, wrapped so a phone shows all of it. Ticking the box is how the app knows it was saved.
function KeyDialog({ open, onOpenChange, owner, saved, value }: { open: boolean; onOpenChange(open: boolean): void; owner: string; saved: boolean; value: string }) {
  const [ticked, setTicked] = useState(false);
  const copy = () => navigator.clipboard.writeText(value).then(
    () => toastManager.add({ type: "success", title: "Recovery key copied" }),
    () => toastManager.add({ type: "error", title: "The key could not be copied", description: "Select it and copy it yourself." }),
  );
  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>{saved ? "Recovery key" : "Save your recovery key"}</DialogTitle>
        <DialogDescription>The only way back in if you lose every device. Adding a device from one that syncs does not need it.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        <p className="select-all break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm" data-testid="recovery-key">{value}</p>
        <Button onClick={() => void copy()} size="sm" variant="outline"><Copy />Copy</Button>
        <p className="text-muted-foreground text-sm">Keep it in a password manager. We never see this key, so we cannot recover it for you.</p>
        {!saved && <Label className="flex items-center gap-2 font-normal"><Checkbox checked={ticked} onCheckedChange={(next) => setTicked(Boolean(next))} />I saved it somewhere safe</Label>}
      </DialogPanel>
      <DialogFooter>
        {saved ? <DialogClose render={<Button />}>Done</DialogClose> : <Button disabled={!ticked} onClick={() => { localStorage.setItem(keySavedName(owner), "true"); onOpenChange(false); }}>Done</Button>}
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}

function NameDialog({ device, it, open, onOpenChange }: { device: Device; it: string; open: boolean; onOpenChange(open: boolean): void }) {
  const [name, setName] = useState(short(device.name)), [error, setError] = useState("");
  useEffect(() => { if (open) { setName(short(device.name)); setError(""); } }, [open, device.name]);
  const save = () => nameDevice(name).then(() => onOpenChange(false), (e) => setError(e instanceof Error ? e.message : String(e)));
  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogPopup className="max-w-sm">
      <Form className="contents" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <DialogHeader><DialogTitle>Name {it}</DialogTitle><DialogDescription>Your other devices list it by this name.</DialogDescription></DialogHeader>
        <DialogPanel className="space-y-3">
          <Field><FieldLabel>Name</FieldLabel><Input maxLength={40} onChange={(event) => setName(event.target.value)} value={name} /></Field>
          {error && <p className="text-destructive-foreground text-sm" role="alert">{error}</p>}
        </DialogPanel>
        <DialogFooter><DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose><Button disabled={!name.trim()} type="submit">Save</Button></DialogFooter>
      </Form>
    </DialogPopup>
  </Dialog>;
}
