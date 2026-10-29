import { expect, test } from '@playwright/test';

// Seam: an image-sized history entry must cross Vercel-sized requests without blocking other pages.
test('large encrypted history is chunked and restored on another device', async ({ browser }) => {
  test.skip(!process.env.CLOUD_QA, 'Requires the isolated cloud fixture server.');
  test.setTimeout(90_000);
  const owner = `qa-large-${Date.now()}`;
  const a = await browser.newContext(), b = await browser.newContext();
  for (const c of [a, b]) await c.addCookies([{ name: 'qa-user', value: owner, url: 'http://127.0.0.1:1431' }]);
  const one = await a.newPage(); await one.goto('http://127.0.0.1:1431');
  const result = await one.evaluate(async () => {
    const { objects } = await import('/src/lib/' + 'objects.ts');
    const { refreshCloud } = await import('/src/lib/' + 'cloud.ts');
    const { enableSync, syncNow, syncKey } = await import('/src/lib/' + 'sync.ts');
    await refreshCloud();
    let random = '';
    for (let i = 0; i < 64; i++) random += String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32768)));
    const text = btoa(random);
    const p = await objects.create({ title: 'Large note', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
    await objects.update(p.id, { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: text + ' edited' }] }] } });
    await objects.create({ title: 'Small note after large note' });
    await enableSync(); await syncNow();
    const { events } = await (await fetch('/api/sync')).json();
    return { key: syncKey(), id: p.id, length: text.length + 7, manifests: events.filter((e: { envelope: { kind?: string } }) => e.envelope.kind === 'manifest').length };
  });
  expect(result.manifests).toBeGreaterThan(0);
  const two = await b.newPage(); await two.goto('http://127.0.0.1:1431');
  const restored = await two.evaluate(async ({ key, id }) => {
    const { objects } = await import('/src/lib/' + 'objects.ts');
    const { refreshCloud } = await import('/src/lib/' + 'cloud.ts');
    const { enableSync, syncNow } = await import('/src/lib/' + 'sync.ts');
    await refreshCloud(); await enableSync(key); await syncNow();
    return { length: (await objects.get(id))?.content?.content?.[0].content?.[0].text?.length, small: (await objects.list()).some((p: { title: string }) => p.title === 'Small note after large note') };
  }, result);
  expect(restored.length).toBe(result.length); expect(restored.small).toBe(true);
  await a.close(); await b.close();
});
