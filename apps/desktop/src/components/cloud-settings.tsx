import { Cloud, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from '@leadinglight/ui/components/dialog';
import { Input } from '@leadinglight/ui/components/input';
import { Label } from '@leadinglight/ui/components/label';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@leadinglight/ui/components/tabs';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarGroup, useSidebar } from '@leadinglight/ui/components/sidebar';
import { useCloud, refreshCloud, signIn, signOut, startCloud } from '~/lib/cloud';
import { PairingSettings } from '~/components/pairing-settings';
import { disableSync, enableSync, syncKey, syncNow, syncEnabled } from '~/lib/sync';

export function CloudButton() {
  return <SidebarGroup className="py-1"><SidebarMenu><SidebarMenuItem><SidebarMenuButton aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event('leadinglight:cloud-account'))}><Cloud className="size-4" /><span>Account and sync</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>;
}

export function CloudSettings() {
  const cloud = useCloud();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false), [tab, setTab] = useState('account');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(''), [showKey, setShowKey] = useState(false);
  useEffect(() => {
    startCloud();
    const account = (event: Event) => { setTab(event instanceof CustomEvent && event.detail === 'agents' ? 'agents' : 'account'); setOpen(true); if (isMobile) setOpenMobile(false); void refreshCloud(); };
    window.addEventListener('leadinglight:cloud-account', account);
    return () => window.removeEventListener('leadinglight:cloud-account', account);
  }, [isMobile, setOpenMobile]);
  const run = async (fn: () => Promise<unknown> | unknown) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const key = syncKey();
  const shownError = error || (tab === 'agents' ? '' : cloud.error);
  return <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Your workspace, everywhere</DialogTitle><DialogDescription>Notes stay on this device. Choose when to connect them.</DialogDescription></DialogHeader>
        <div className="space-y-4 px-6 pb-6">
          {shownError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{shownError}</p>}
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <TabsList><TabsTab value="account">Account</TabsTab><TabsTab value="sync">Sync</TabsTab><TabsTab value="agents">Agents</TabsTab></TabsList>
            <TabsPanel value="account" className="space-y-4 pt-4">
              {cloud.user ? <><p className="font-medium">{cloud.user.name}</p><p className="text-muted-foreground text-sm">This account owns your encrypted sync storage. Sign in with the same provider on each device.</p><Button disabled={busy} variant="outline" onClick={() => void run(signOut)}>Sign out</Button></> : <>
                <p className="text-sm">You can keep writing without an account. Sign in to connect another device.</p>
                {cloud.config.providers.map((p) => <Button className="mr-2" disabled={busy} key={p.id} onClick={() => void run(() => signIn(p.id))} variant="outline">Continue with {p.name}</Button>)}
                {!cloud.config.providers.length && <p className="text-muted-foreground text-sm">{navigator.onLine ? 'Cloud accounts are not configured in this installation yet.' : 'Sign-in is available when you are back online. Your local notes still work.'}</p>}
                <p className="text-muted-foreground text-xs">Workspace sign-in connects your notes. Agents use the CLI account already signed in on your Mac.</p>
              </>}
              <Button variant="ghost" onClick={() => setOpen(false)}>Continue on this device</Button>
            </TabsPanel>
            <TabsPanel value="sync" className="space-y-4 pt-4">
              <p className="text-sm">Sync runs in the background using your local database. Our cloud stores encrypted copies of notes and history. Your recovery key unlocks them on another device.</p>
              <p className="text-muted-foreground text-sm">If two offline devices change the same page, both versions are kept. Local folders and Mac file attachments stay on the Mac.</p>
              {key && syncEnabled() ? <>
                <p className="font-medium">{cloud.sync}</p>
                <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(syncNow)} size="sm"><RefreshCw className="size-4" />Sync now</Button><Button onClick={() => setShowKey(!showKey)} size="sm" variant="outline">{showKey ? 'Hide' : 'Show'} recovery key</Button><Button onClick={() => { disableSync(); setShowKey(false); }} size="sm" variant="ghost">Pause sync on this device</Button></div>
                {showKey && <><Label htmlFor="sync-key">Recovery key — save this somewhere private</Label><Input id="sync-key" readOnly value={key} onFocus={(e) => e.target.select()} /><p className="text-muted-foreground text-xs">We cannot recover encrypted notes if you lose this key and every connected device. Pausing keeps your recovery key, local notes and encrypted cloud copies intact.</p></>}
              </> : <>
                <Label htmlFor="recovery-key">Connecting another device?</Label><Input autoComplete="off" id="recovery-key" onChange={(e) => setRecovery(e.target.value)} placeholder="Paste the recovery key from your other device" value={recovery} />
                <Button disabled={!cloud.user || !cloud.config.allowed || busy} onClick={() => void run(async () => { await enableSync(recovery); setShowKey(true); await syncNow(); })}>{recovery.trim() ? 'Connect this device' : key ? 'Resume sync' : 'Set up encrypted sync'}</Button>
                {!cloud.user && <p className="text-muted-foreground text-sm">Sign in to connect devices. Your local notes remain available.</p>}
              </>}
              {key && syncEnabled() && cloud.error.startsWith('The recovery key does not match') && <div className="space-y-2"><Label htmlFor="replace-key">Recovery key from another device</Label><Input id="replace-key" value={recovery} onChange={(e) => setRecovery(e.target.value)} /><Button disabled={busy || !recovery.trim()} onClick={() => void run(async () => { await enableSync(recovery); await syncNow(); })}>Use this recovery key</Button></div>}
              {cloud.user && !cloud.config.allowed && <p className="text-muted-foreground text-sm">Cloud access has not been enabled for this account yet.</p>}
            </TabsPanel>
            <TabsPanel value="agents" className="space-y-4 pt-4">
              <PairingSettings />
            </TabsPanel>
          </Tabs>
        </div>
      </DialogPopup>
    </Dialog>
  </>;
}
