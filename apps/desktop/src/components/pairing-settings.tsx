import { Copy, Laptop, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from '@leadinglight/ui/components/card';
import { Input } from '@leadinglight/ui/components/input';
import { Label } from '@leadinglight/ui/components/label';
import { Alert, AlertDescription } from '@leadinglight/ui/components/alert';
import { isDesktop, useMobile } from '~/lib/platform';
import { useCloud } from '~/lib/cloud';
import { createPair, refreshPairs, removePair, selectPair, selectedPair, useRemote } from '~/lib/remote';

export const openPairingSettings = () => window.dispatchEvent(new CustomEvent('leadinglight:cloud-account', { detail: 'agents' }));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const codexSignedIn = (status: unknown) => Boolean((status as { account?: { result?: { account?: unknown } } } | null)?.account?.result?.account);
const deadline = (pair: { expiresAt: string; serverTime?: string }) => performance.now() + Math.max(0, Date.parse(pair.expiresAt) - (pair.serverTime ? Date.parse(pair.serverTime) : Date.now()));

export function PairingSettings() {
  const mobile = useMobile();
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => { void isDesktop.then(setDesktop); }, []);
  if (mobile) return <p className="text-sm text-muted-foreground">Agents are not available in the iPad app. Your notes and sync still work.</p>;
  if (desktop === null) return <p className="text-sm text-muted-foreground">Checking this device…</p>;
  return desktop ? <MacPairing /> : <BrowserPairing />;
}

export function RemoteAgentConnection() {
  const remote = useRemote(), pair = selectedPair();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [takeover, setTakeover] = useState(false);
  const connect = async (take = false) => {
    if (!pair) return;
    setBusy(true); setError('');
    try { await selectPair(pair.id, { takeover: take }); setTakeover(false); }
    catch (e) { setError(message(e)); setTakeover((e as { status?: number }).status === 409); }
    finally { setBusy(false); }
  };
  if (!pair) return null;
  return <div className="space-y-2 border-b px-3 py-2 text-sm">
    <div className="flex items-center gap-2"><Laptop className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{pair.macName || 'Your Mac'}</span><Button size="xs" variant="ghost" onClick={openPairingSettings}>Manage</Button></div>
    <p className="text-xs text-muted-foreground">{pair.state !== 'active' ? 'This connection is no longer available.' : !pair.online ? 'Offline — open LeadingLight on this Mac and keep it awake.' : remote.connected ? 'Connected. Agents use your Mac’s CLI sign-in. Keep both apps open.' : 'Ready to connect. Choose Use this Mac to start.'}</p>
    {pair.state === 'active' && pair.online && !remote.connected && <Button disabled={busy || remote.connecting || !pair.localKey} size="sm" variant="outline" onClick={() => void connect()}>Use this Mac</Button>}
    {(error || remote.error) && <p role="alert" className="text-xs text-destructive">{error || remote.error}</p>}
    {takeover && <><p className="text-xs text-muted-foreground">Taking over stops work controlled by the other tab.</p><Button disabled={busy} size="sm" variant="outline" onClick={() => void connect(true)}>Take over connection</Button></>}
  </div>;
}

function BrowserPairing() {
  const cloud = useCloud(), remote = useRemote();
  const [name, setName] = useState('This browser'), [invite, setInvite] = useState<{ code: string; id: string; deadline: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false), [takeover, setTakeover] = useState<string | null>(null);
  useEffect(() => {
    setInvite(null); setCopied(false); setTakeover(null);
    if (!cloud.user) return;
    void refreshPairs();
    const timer = window.setInterval(() => void refreshPairs(), 5000);
    return () => window.clearInterval(timer);
  }, [cloud.user?.id]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const connect = (id: string, take = false) => run(async () => {
    try { await selectPair(id, { takeover: take }); setTakeover(null); }
    catch (e) { setTakeover((e as { status?: number }).status === 409 ? id : null); throw e; }
  });
  const invitation = remote.pairs.find((p) => p.id === invite?.id);
  useEffect(() => { if (invitation?.state === 'revoked') setInvite(null); }, [invitation?.state]);
  const expired = !!invite && invitation?.state !== 'active' && invite.deadline <= performance.now();
  const minutes = invite ? Math.max(1, Math.ceil((invite.deadline - performance.now()) / 60_000)) : 5;
  return <div className="space-y-4">
    <p className="text-sm">Use Claude Code and Codex already signed in on your Mac. Your own provider usage applies; LeadingLight does not charge for model usage.</p>
    <p className="text-sm text-muted-foreground">Prompts and replies are encrypted between this browser and your Mac. Both apps must stay open and connected. Pairing does not turn on note sync.</p>
    {(error || remote.error) && <Alert variant="error"><AlertDescription>{error || remote.error}</AlertDescription></Alert>}
    {!cloud.initialized || !remote.initialized ? <p role="status" className="text-sm text-muted-foreground">Loading your Mac connections…</p> : !cloud.user ? <p className="text-sm">Sign in on the Account tab before connecting a Mac.</p> : !cloud.config.allowed ? <p className="text-sm">Connections have not been enabled for this workspace account yet.</p> : <>
      {!invite ? <div className="space-y-2"><Label htmlFor="browser-name">Browser name</Label><Input id="browser-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /><Button disabled={busy || !name.trim()} onClick={() => void run(async () => { const result = await createPair(name.trim()); setInvite({ code: result.code, id: result.pair.id, deadline: deadline(result.pair) }); setCopied(false); })}>Connect a Mac</Button></div> : <Card>
        <CardHeader><CardTitle>{expired ? 'Pairing code expired' : invitation?.state === 'active' ? 'Mac approved' : invitation?.state === 'review' ? 'Waiting for approval on your Mac' : 'Connect in the Mac app'}</CardTitle><CardDescription>{expired ? 'Create a new code to try again.' : invitation?.state === 'active' ? 'Choose Use this Mac below when you are ready.' : `Expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Paste this code in LeadingLight on your Mac: Account and sync → Agents.`}</CardDescription></CardHeader>
        <CardPanel className="space-y-3">
          {!expired && invitation?.state !== 'active' && <><Label htmlFor="pairing-code">Pairing code</Label><Input id="pairing-code" readOnly value={invite.code} autoComplete="off" onFocus={(e) => e.target.select()} /><Button size="sm" variant="outline" onClick={() => void run(async () => { await navigator.clipboard.writeText(invite.code); setCopied(true); })}><Copy className="size-4" />{copied ? 'Copied' : 'Copy code'}</Button><p className="text-xs text-muted-foreground">Share this code only with your Mac. Review the browser and workspace account there, then choose Allow this browser.</p></>}
          <Button disabled={busy} size="sm" variant="ghost" onClick={() => void run(async () => { if (invitation?.state !== 'active') await removePair(invite.id); setInvite(null); })}>{invitation?.state === 'active' ? 'Done' : 'Cancel pairing'}</Button>
        </CardPanel>
      </Card>}
      {remote.pairs.filter((p) => p.state === 'active').map((pair) => <Card key={pair.id}>
        <CardHeader><CardTitle>{pair.macName || 'Your Mac'}</CardTitle><CardDescription>{pair.online ? 'Online' : 'Offline — open LeadingLight on this Mac and keep it awake.'}</CardDescription></CardHeader>
        <CardPanel className="space-y-3">
          {pair.status && <p className="text-sm">Claude Code: {pair.status.claude.logged_in ? 'signed in' : pair.status.claude.installed ? 'sign in on your Mac' : 'not installed'} · Codex: {codexSignedIn(pair.status.codex) ? 'signed in' : 'sign in on your Mac'}</p>}
          {!pair.localKey && <p className="text-sm text-muted-foreground">This browser does not have this connection’s key. Connect your Mac again from this browser.</p>}
          <div className="flex flex-wrap gap-2"><Button disabled={busy || remote.connecting || !pair.online || !pair.localKey || (remote.selected === pair.id && remote.connected)} size="sm" onClick={() => void connect(pair.id)}>{remote.selected === pair.id && remote.connected ? 'Connected' : 'Use this Mac'}</Button><Button disabled={busy} size="sm" variant="outline" onClick={() => void run(() => removePair(pair.id))}>Remove connection</Button></div>
          {takeover === pair.id && <><p className="text-xs text-muted-foreground">Another tab controls this Mac. Taking over stops its active work.</p><Button disabled={busy} size="sm" variant="outline" onClick={() => void connect(pair.id, true)}>Take over connection</Button></>}
        </CardPanel>
      </Card>)}
      <Button disabled={busy} size="sm" variant="ghost" onClick={() => void run(refreshPairs)}><RefreshCw className="size-4" />Refresh connections</Button>
    </>}
  </div>;
}

type NativePair = { id: string; accountName: string; browserName: string; macName: string; state?: string; expiresAt: string; serverTime?: string; deadline?: number; online?: boolean; error?: string };
function MacPairing() {
  const [code, setCode] = useState(''), [macName, setMacName] = useState('My Mac'), [review, setReview] = useState<NativePair | null>(null), [pairs, setPairs] = useState<NativePair[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const call = async <T,>(command: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(command, args);
  const refresh = async () => { const result = await call<NativePair[] | { pairs: NativePair[] }>('relay_list'); setPairs(Array.isArray(result) ? result : result.pairs); };
  useEffect(() => { void refresh().catch((e) => setError(message(e))); const timer = window.setInterval(() => void refresh().catch((e) => setError(message(e))), 5000); return () => window.clearInterval(timer); }, []);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  const expired = review?.deadline !== undefined && review.deadline <= performance.now();
  return <div className="space-y-4">
    <p className="text-sm">Allow a browser to use Claude Code and Codex on this Mac. Your CLI sign-in stays here. Keep LeadingLight running and your Mac awake while the browser works.</p>
    {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
    {!review ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const pair = await call<NativePair>('relay_preview', { code: code.trim(), macName: macName.trim() }); setReview({ ...pair, deadline: deadline(pair) }); setCode(''); }); }}>
      <Label htmlFor="mac-name">Mac name</Label><Input id="mac-name" value={macName} maxLength={80} onChange={(e) => setMacName(e.target.value)} />
      <Label htmlFor="browser-code">Pairing code from your browser</Label><Input id="browser-code" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} placeholder="Paste the code from the web app" />
      <Button disabled={busy || !code.trim() || !macName.trim()} type="submit">Review connection</Button>
    </form> : <Card>
      <CardHeader><CardTitle>{expired ? 'Pairing code expired' : 'Allow this browser?'}</CardTitle><CardDescription>{review.browserName} · {review.accountName}</CardDescription></CardHeader>
      <CardPanel className="space-y-3"><p className="text-sm">This browser can run page agents using your CLI accounts on {review.macName}. Page tools and approvals stay in that browser. Agents can also search and fetch web pages using this Mac’s network, following the approval mode selected in the browser. It cannot control project folders or terminals. You can revoke access here.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || expired} onClick={() => void run(async () => { await call('relay_approve', { id: review.id }); setReview(null); await refresh(); })}>Allow this browser</Button><Button disabled={busy} variant="outline" onClick={() => void run(async () => { await call('relay_revoke', { id: review.id }); setReview(null); await refresh(); })}>Decline</Button></div>
      </CardPanel>
    </Card>}
    {pairs.filter((pair) => pair.state !== 'revoked' && pair.id !== review?.id).map((pair) => <Card key={pair.id}><CardHeader><CardTitle>{pair.browserName}</CardTitle><CardDescription>{pair.accountName} · {pair.state === 'review' ? 'Awaiting approval' : 'Browser allowed'}</CardDescription></CardHeader><CardPanel className="space-y-3">{pair.state === 'review' && <Button disabled={busy} size="sm" onClick={() => setReview(pair)}>Review connection</Button>}{pair.error && <p role="alert" className="text-sm text-destructive">{pair.error}</p>}<Button disabled={busy} size="sm" variant="outline" onClick={() => void run(async () => { await call('relay_revoke', { id: pair.id }); await refresh(); })}>Revoke browser access</Button></CardPanel></Card>)}
  </div>;
}
