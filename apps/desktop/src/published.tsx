import { Component, StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockEditor, type NotesStore } from '@leadinglight/editor/editor';
import type { AssetStore } from '@leadinglight/editor/assets';
import { Button } from '@leadinglight/ui/components/button';
import { TooltipProvider } from '@leadinglight/ui/components/tooltip';
import { isPublishedSnapshot, publishedDoc, publicLink, type PublishedSnapshot } from './lib/published-content';
import './styles.css';
import './published.css';

const assets: AssetStore = {
  put: async () => { throw new Error('This page is read only.'); },
  open: (asset) => {
    if (!publicLink(asset.url) && !/^data:[\w.+/-]+;base64,[a-z\d+/=]*$/i.test(asset.url)) return;
    const link = document.createElement('a');
    link.href = asset.url; link.download = asset.name || 'attachment'; link.rel = 'noopener noreferrer';
    link.target = '_blank'; link.click();
  },
};
const openLink = (href: string) => { if (publicLink(href)) window.open(href, '_blank', 'noopener,noreferrer'); };
const nothing = () => {};

class ReadablePage extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="space-y-3"><p role="alert">This page could not be displayed. Try reloading it.</p><Button variant="outline" onClick={() => location.reload()}>Reload page</Button></div> : this.props.children;
  }
}

function Reader() {
  const [page, setPage] = useState<PublishedSnapshot | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const token = /^\/p\/([A-Za-z0-9_-]{32})$/.exec(location.pathname)?.[1];
    const load = async () => {
      let timer: number | undefined;
      try {
        if (!token) throw new Error('This page is unavailable');
        const result: unknown = await Promise.race([
          fetch(`/api/published/${token}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) }).then((response) => {
            if (response.status === 404) throw new Error('This page is unavailable');
            if (!response.ok) throw new Error('The shared page could not be reached. Try again.');
            return response.json();
          }),
          new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('The shared page could not be reached. Try again.')), 20_000); }),
        ]);
        if (!isPublishedSnapshot(result)) throw new Error('This published page could not be read. Try again or ask the owner to publish it again.');
        if (stopped) return;
        setPage((previous) => JSON.stringify(previous) === JSON.stringify(result) ? previous : result); setError('');
        document.title = `${result.title || 'Untitled'} · LeadingLight`;
      } catch (e) {
        if (stopped) return;
        setPage(null); setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'The shared page could not be reached. Try again.');
        document.title = 'Shared page · LeadingLight';
      } finally { window.clearTimeout(timer); }
    };
    void load();
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    const offline = () => { setPage(null); setError('You’re offline. Connect to read this shared page.'); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('pageshow', visible); window.addEventListener('offline', offline); window.addEventListener('online', visible);
    return () => { stopped = true; controller.abort(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', visible); window.removeEventListener('offline', offline); window.removeEventListener('online', visible); };
  }, [retry]);
  const content = useMemo(() => page ? publishedDoc(page.content) : null, [page]);
  const notes = useMemo<NotesStore>(() => {
    const byId = new Map(page?.notes.map((note) => [note.id, publishedDoc(note.body).content]));
    return { read: (id) => byId.get(id), add: nothing, remove: nothing, write: nothing };
  }, [page]);
  return <main className="ll-published isolate" data-has-notes={!!page?.notes.length || undefined}>
    <header className="mb-8 flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>LeadingLight</span><span>Shared page · Read only</span></header>
    {error ? <div className="space-y-3"><h1 className="text-xl font-semibold" role="alert">{error}</h1><p className="text-sm text-muted-foreground">{error === 'This page is unavailable' ? 'The link may be incorrect or the owner may have unpublished it.' : 'This page needs an internet connection.'}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div> : !page ? <p role="status" className="text-sm text-muted-foreground">Loading shared page…</p> : <ReadablePage key={JSON.stringify(page)}><article onClickCapture={(event) => {
      const link = (event.target as HTMLElement).closest('a[href]');
      if (!link) return;
      event.preventDefault(); event.stopPropagation(); openLink(link.getAttribute('href') ?? '');
    }}>
      <h1 className="mb-3 text-4xl font-bold tracking-tight break-words">{page.title || 'Untitled'}</h1>
      {page.description && <p className="mb-6 whitespace-pre-wrap break-words text-muted-foreground">{page.description}</p>}
      <BlockEditor content={content} style={page.style} assets={assets} notes={notes} openLink={openLink} readOnly label="Published page" />
    </article></ReadablePage>}
  </main>;
}

document.body.classList.add('ll-published-body');
const theme = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', theme.matches);
applyTheme(); theme.addEventListener('change', applyTheme);
createRoot(document.getElementById('root')!).render(<StrictMode><TooltipProvider><Reader /></TooltipProvider></StrictMode>);
