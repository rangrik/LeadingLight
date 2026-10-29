import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  return {
    name: 'leadinglight-offline',
    generateBundle(_options, bundle) {
      const shell = new Set<string>();
      const visit = (name: string) => {
        if (shell.has(name)) return;
        shell.add(name);
        const chunk = bundle[name];
        if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
      };
      for (const [name, chunk] of Object.entries(bundle)) if ((chunk.type === 'chunk' && chunk.isEntry && chunk.name === 'main') || /\.(css|woff2?)$/.test(name)) visit(name);
      const files = [...shell].map((file) => `/${file}`);
      const cache = `leadinglight-${Date.now()}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(['/index.html', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/builtin-plugins/index.json', ...files])};
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('leadinglight-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/index.html', { ignoreVary: true }))));
  else if (FILES.includes(url.pathname) || url.pathname.startsWith('/assets/')) event.respondWith(caches.open(CACHE).then(async (cache) => { const cached = await cache.match(event.request, { ignoreVary: true }); if (cached) return cached; const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }));
});
` });
    },
  };
}
