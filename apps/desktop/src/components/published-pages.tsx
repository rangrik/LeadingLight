import { useState } from 'react';
import { SettingsGroup, SettingsRow } from '@/views/settings/rows';
import { Button } from '@leadinglight/ui/components/button';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@leadinglight/ui/components/dialog';
import { cloudApi } from '~/lib/cloud';
import { unpublishPage } from '~/lib/publishing';
import type { Publication } from '~/lib/published-content';

type Entry = Publication & { page: string; title: string };

export function PublishedPages({ owner }: { owner: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pages, setPages] = useState<Entry[]>([]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const load = () => run(async () => { const result = await cloudApi<{ publications: Entry[] }>('publications/status', {}, 'POST', owner); setPages(result.publications); });
  return <SettingsGroup title="Published pages" description="Manage shared copies, including pages you removed from this device.">
    <SettingsRow label="Shared links" description="Copies stay online until you unpublish them."><Button variant="outline" size="sm" onClick={() => { setOpen(true); void load(); }}>Manage published pages</Button></SettingsRow>
    <Dialog open={open} onOpenChange={setOpen}><DialogPopup><DialogHeader><DialogTitle>Published pages</DialogTitle><DialogDescription>Only you can see this list. Unpublishing stops future reads from that link.</DialogDescription></DialogHeader>
      <DialogPanel className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive-foreground">{error}</p>}
        {!busy && !error && !pages.length && <p className="text-sm text-muted-foreground">No published pages.</p>}
        {pages.map((page) => <SettingsRow key={page.page} label={page.title || 'Untitled'} description={`Published ${new Date(page.updatedAt).toLocaleDateString()}`}>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(page.url))}>Copy link</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await unpublishPage(page.page, owner); setPages((before) => before.filter((entry) => entry.page !== page.page)); })}>Unpublish</Button>
        </SettingsRow>)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Refresh'}</Button>
      </DialogPanel>
    </DialogPopup></Dialog>
  </SettingsGroup>;
}
