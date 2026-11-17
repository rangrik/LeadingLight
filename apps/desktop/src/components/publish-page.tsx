// Uses the same COSS dialog composition as the page's Save as type dialog.
import { useEffect, useRef, useState } from 'react';
import { Copy, Globe } from 'lucide-react';
import { Button } from '@leadinglight/ui/components/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@leadinglight/ui/components/dialog';
import { Input } from '@leadinglight/ui/components/input';
import { Label } from '@leadinglight/ui/components/label';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@leadinglight/ui/components/tooltip';
import { useCloud } from '~/lib/cloud';
import { publicationStatus, publishPage, unpublishPage } from '~/lib/publishing';
import type { Publication } from '~/lib/published-content';

export function PublishPage({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  return <><Tooltip><TooltipTrigger render={<Button aria-label="Publish page" size="icon-sm" variant="ghost" onClick={() => setOpen(true)} />}><Globe className="size-4" /></TooltipTrigger><TooltipPopup>Publish page</TooltipPopup></Tooltip>{open && <PublishDialog page={page} onClose={() => setOpen(false)} />}</>;
}

export function PublishDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { user, config } = useCloud();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const owner = user?.id;
  const current = useRef({ page, owner });
  current.current = { page, owner };
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setPublication(null); setError(''); setMessage('');
    if (owner) void publicationStatus(page, owner).then((result) => { if (!cancelled) { setPublication(result.publication); setLoaded(true); } }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [page, owner]);
  const run = async (action: 'publish' | 'unpublish' | 'retry') => {
    if (!owner || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await (action === 'unpublish' ? unpublishPage(page, owner) : action === 'retry' ? publicationStatus(page, owner) : publishPage(page, owner));
      if (current.current.page !== page || current.current.owner !== owner) return;
      setPublication(result.publication); setLoaded(true);
      if (action !== 'retry') setMessage(action === 'unpublish' ? 'Unpublished. The old link no longer works.' : 'Published. The link shows this saved version.');
    } catch (e) {
      if (current.current.page !== page || current.current.owner !== owner) return;
      setError(e instanceof Error ? e.message : String(e));
      if (action !== 'retry') {
        // The server may have saved the change before the connection dropped.
        try {
          const result = await publicationStatus(page, owner);
          if (current.current.page === page && current.current.owner === owner) { setPublication(result.publication); setLoaded(true); }
        } catch { setLoaded(false); }
      }
    }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPopup>
      <DialogHeader><DialogTitle>Publish page</DialogTitle><DialogDescription>Share a read-only copy with anyone who has the link.</DialogDescription></DialogHeader>
      <DialogPanel className="space-y-4">
        <p className="text-sm text-muted-foreground">Includes the title, description, page content, attachments and sidenotes. Linked page titles appear as plain text; their contents and history stay private. Later edits appear only when you update the published page.</p>
        <p className="text-sm text-muted-foreground">Search engines are asked not to index this page. Anyone with the link can read, copy or forward it. Publishing uploads a readable copy, separate from encrypted sync.</p>
        {!owner ? <p className="text-sm">Sign in to publish this page. Readers do not need an account.</p> : !loaded && !error ? <p role="status" className="text-sm text-muted-foreground">Checking publication…</p> : publication && <div className="space-y-2">
          <Label htmlFor="published-link">Share link</Label>
          <div className="flex items-center gap-2"><Input id="published-link" readOnly value={publication.url} onFocus={(event) => event.currentTarget.select()} /><Button aria-label="Copy link" variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(publication.url).then(() => setMessage('Link copied.')).catch(() => setError('Select the link and copy it to your clipboard.'))}><Copy className="size-4" /></Button></div>
          <p className="text-xs text-muted-foreground">Published {new Date(publication.updatedAt).toLocaleString()}</p>
        </div>}
        {owner && config.allowed === false && <p className="text-sm text-muted-foreground">Publishing has not been enabled for this account.</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive-foreground">{error}</p>}
      </DialogPanel>
      <DialogFooter>
        {!owner ? <Button onClick={() => { onClose(); window.dispatchEvent(new Event('leadinglight:cloud-account')); }}>Account and devices</Button> : <>
          {publication && <Button variant="outline" disabled={busy} onClick={() => void run('unpublish')}>Unpublish</Button>}
          {!loaded && error ? <Button disabled={busy} onClick={() => void run('retry')}>Try again</Button> : <Button disabled={!loaded || busy || config.allowed === false} onClick={() => void run('publish')}>{busy ? 'Working…' : publication ? 'Update published page' : 'Publish'}</Button>}
        </>}
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
