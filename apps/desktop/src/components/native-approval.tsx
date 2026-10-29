import { useEffect, useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from '@leadinglight/ui/components/dialog';
import { Input } from '@leadinglight/ui/components/input';
import { Label } from '@leadinglight/ui/components/label';
import { cloudApi, cloudState, setCloud, signIn, useCloud } from '~/lib/cloud';
import { approveNativeAccount, connectionCode, snapshotSyncSettings, type NativeApproval } from '~/lib/native-account';
import { enableSync, syncKey } from '~/lib/sync';

export function NativeApprovalDialog() {
  const cloud = useCloud();
  const [id, setId] = useState(() => new URL(location.href).searchParams.get('connect'));
  const [approval, setApproval] = useState<NativeApproval>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const [recovery, setRecovery] = useState('');
  useEffect(() => {
    if (!id || !cloud.user) return;
    let current = true;
    void cloudApi<NativeApproval>(`native/approval?id=${encodeURIComponent(id)}`).then((value) => { if (current) setApproval(value); }).catch((e) => { if (current) setError(String(e.message || e)); });
    return () => { current = false; };
  }, [id, cloud.user?.id]);
  const close = () => { const url = new URL(location.href); url.searchParams.delete('connect'); history.replaceState(null, '', url); setId(null); };
  const approve = async () => {
    if (!approval || !cloud.user) return;
    setBusy(true); setError('');
    const rollback = snapshotSyncSettings(cloud.user.id);
    setCloud({ verifying: true });
    try {
      if (cloudState().user?.id !== cloud.user.id) throw new Error('The account changed. Start this connection again.');
      if (!syncKey()) await enableSync(recovery);
      await approveNativeAccount(approval, cloud.user.id, syncKey());
      setDone(true);
    } catch (e) { rollback(); setError(e instanceof Error ? e.message : String(e)); }
    finally { setCloud({ verifying: false }); setBusy(false); }
  };
  return <Dialog open={Boolean(id)} onOpenChange={(open) => { if (!open) close(); }}>
    <DialogPopup className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{done ? 'Device approved' : 'Connect your device'}</DialogTitle><DialogDescription>{done ? 'Return to LeadingLight on your device to finish syncing.' : 'Use your workspace account to keep notes available on your Mac and iPad.'}</DialogDescription></DialogHeader>
      <div className="space-y-4 px-6 pb-6">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done ? <Button onClick={close}>Done</Button> : cloud.user ? <>
          <p className="min-w-0 break-words text-sm">{approval ? `${approval.deviceName} will connect to ${cloud.user.name} and receive the key for your encrypted notes.` : error ? 'Start a new connection in the LeadingLight app.' : 'Checking this connection…'}</p>
          {approval && <p className="text-sm">Check that code <strong className="font-mono">{connectionCode(approval.id)}</strong> matches the code in your app before approving.</p>}
          {!syncKey() && <><Label htmlFor="device-recovery">Recovery key, if you already use sync</Label><Input id="device-recovery" type="password" autoComplete="off" value={recovery} onChange={(event) => setRecovery(event.target.value)} /><p className="text-muted-foreground text-sm">Leave this blank to set up sync for the first time.</p></>}
          <div className="flex gap-2"><Button disabled={!approval || busy || !cloud.config.allowed} onClick={() => void approve()}>Connect this device</Button><Button variant="outline" onClick={close}>Cancel</Button></div>
          {!cloud.config.allowed && <p className="text-muted-foreground text-sm">Cloud access is not enabled for this account.</p>}
        </> : <>
          <p className="text-sm">Sign in with the same provider you use for your workspace.</p>
          {cloud.config.providers.map((provider) => <Button className="mr-2" key={provider.id} variant="outline" onClick={() => void signIn(provider.id).catch((e) => setError(String(e)))}>Continue with {provider.name}</Button>)}
        </>}
      </div>
    </DialogPopup>
  </Dialog>;
}
