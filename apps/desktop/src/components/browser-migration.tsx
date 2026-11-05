import { useEffect, useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import { Alert, AlertTitle, AlertDescription } from '@leadinglight/ui/components/alert';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from '@leadinglight/ui/components/dialog';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '@leadinglight/ui/components/empty';
import { APP_ORIGIN, OLD_ORIGIN, COPY_READY, copyBrowserNotes, hasBrowserNotes, receiveBrowserNotes } from '~/lib/browser-copy';
import { flushAll } from '~/lib/saving';

export function BrowserAddressBanner() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [copied, setCopied] = useState(false);
  if (location.origin !== OLD_ORIGIN) return null;
  const copy = async () => {
    setBusy(true); setMessage('');
    try { const count = await copyBrowserNotes(flushAll); setCopied(true); setMessage(`${count} notes copied. Continue in the new tab. This original copy stays here.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The copy failed. Your original notes are safe.'); }
    finally { setBusy(false); }
  };
  return <>
    <Alert className="mb-2 shrink-0"><AlertTitle>LeadingLight has a new address</AlertTitle><AlertDescription>{message || 'Copy your saved notes, attachments and history directly to leadinglight.app. Keep both tabs open until the copy finishes.'}<div><Button size="sm" disabled={busy} onClick={() => void copy()}>{copied ? 'Copy again' : 'Copy notes to leadinglight.app'}</Button>{copied && <Button size="sm" variant="ghost" render={<a href={APP_ORIGIN} target="_blank" rel="noreferrer" />}>Open leadinglight.app</Button>}</div></AlertDescription></Alert>
    <Dialog open={busy}><DialogPopup showCloseButton={false}><DialogHeader><DialogTitle>Copying your saved workspace</DialogTitle><DialogDescription>Keep both tabs open. The new tab will confirm when the copy is saved. Your original notes stay at this address.</DialogDescription></DialogHeader></DialogPopup></Dialog>
  </>;
}

export function BrowserAddressEntry({ children }: { children: React.ReactNode }) {
  const [copy] = useState(() => new URLSearchParams(location.search).has('copy'));
  const [ready, setReady] = useState(() => location.origin !== APP_ORIGIN || localStorage.getItem(COPY_READY) === 'true');
  const [checked, setChecked] = useState(ready), [message, setMessage] = useState('Waiting for your original workspace…'), [ok, setOk] = useState(false);
  useEffect(() => {
    if (copy) return receiveBrowserNotes((text, saved) => { setMessage(text); setOk(saved); });
    if (!ready) void hasBrowserNotes().then((exists) => { setReady(exists); setChecked(true); }).catch(() => { setMessage('Browser storage could not be opened. Allow site storage and reload to continue.'); });
  }, [copy, ready]);
  if (!copy && ready) return children;
  return <Empty className="mx-auto min-h-svh max-w-xl p-6"><EmptyHeader><EmptyTitle>{copy ? ok ? 'Your workspace is copied' : 'Copy your workspace' : 'Welcome to leadinglight.app'}</EmptyTitle><EmptyDescription>{copy || !checked ? message : 'If you used LeadingLight at its earlier browser address, copy that workspace first to keep your notes and history together.'}</EmptyDescription></EmptyHeader><EmptyContent>
    {copy ? ok ? <Button render={<a href="/" />}>Open your notes</Button> : <Button variant="outline" render={<a href={OLD_ORIGIN} />}>Back to the original workspace</Button> : checked && <><Button render={<a href={OLD_ORIGIN} />}>Copy my earlier workspace</Button><Button variant="outline" onClick={() => { localStorage.setItem(COPY_READY, 'true'); setReady(true); }}>Start a new workspace here</Button></>}
  </EmptyContent></Empty>;
}
