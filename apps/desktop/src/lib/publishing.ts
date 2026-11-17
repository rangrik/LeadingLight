import type { EditorDoc } from '@leadinglight/editor/editor';
import { readSyncAsset } from './assets';
import { cloudApi, cloudState } from './cloud';
import { liveSnapshot } from './live';
import { objects } from './objects';
import { pageOf } from './space';
import { flushAll } from './saving';
import { packAssets, unpackAssets, toBase64 } from './sync-assets';
import { thoughtsContent } from './thoughts';
import { readPaper } from './paper';
import { publishedDoc, publishedNotes, type Publication, type PublishedSnapshot } from './published-content';

export const publicationStatus = (page: string, owner: string) => cloudApi<{ publication: Publication | null }>('publications/status', { page }, 'POST', owner);
export const unpublishPage = (page: string, owner: string) => cloudApi<{ publication: null }>('publications/unpublish', { page }, 'POST', owner);

export async function publishPage(id: string, owner: string) {
  const bound = localStorage.getItem('leadinglight.sync-owner');
  if ((bound && bound !== owner) || cloudState().user?.id !== owner) throw new Error('Sign in to the account this page belongs to before publishing.');
  await flushAll();
  const saved = await objects.get(id);
  if (!saved) throw new Error('This page no longer exists.');
  const page = { ...saved, ...liveSnapshot(id) };
  let content = page.content ?? { type: 'doc', content: [] };
  const thoughtId = page.properties.thoughts;
  const thoughts = (typeof thoughtId === 'string' ? liveSnapshot(thoughtId)?.content : null) ?? thoughtsContent(id) ?? (typeof thoughtId === 'string' ? (await objects.get(thoughtId))?.content : null) ?? { type: 'doc' };
  const paper = readPaper(page.properties.paper);
  if (paper) {
    // Notebook ink is saved as a preview; its text, photos and recordings follow in reading order.
    if (paper.ink && !paper.preview) throw new Error('Open this notebook on its device to save a handwriting preview before publishing.');
    const media = (type: string, a: { url: string; name: string; mime: string; size: number }): EditorDoc => ({ type, attrs: { src: a.url, name: a.name, mime: a.mime, size: a.size } });
    content = { ...content, content: [...(content.content ?? []), ...(paper.preview ? [media('image', paper.preview)] : []), ...[...paper.items].sort((a, b) => a.y - b.y || a.x - b.x).map((item): EditorDoc => item.kind === 'text' ? { type: 'paragraph', content: item.text ? [{ type: 'text', text: item.text }] : [] } : item.asset ? media(item.kind, item.asset) : { type: 'paragraph' })] };
  }
  const snapshot: PublishedSnapshot = { version: 1, style: page.properties.style === 'playful' ? 'playful' : 'plain', title: page.title, description: typeof page.properties.description === 'string' ? page.properties.description : '', content, notes: publishedNotes(content, thoughts) };
  const packed = await packAssets(snapshot, readSyncAsset);
  const portable = await unpackAssets(packed.value, packed.assets, async (asset, bytes) => `data:${asset.mime};base64,${toBase64(bytes)}`);
  const label = (pageId: string) => pageOf(pageId)?.title || 'Private page';
  portable.content = publishedDoc(portable.content, label);
  portable.notes = portable.notes.map((note) => ({ ...note, body: publishedDoc(note.body, label) }));
  if (new TextEncoder().encode(JSON.stringify({ page: id, snapshot: portable })).length > 3_500_000) throw new Error('This page is too large to publish (3.5 MB including attachments). Reduce large attachments and try again.');
  return cloudApi<{ publication: Publication }>('publications/publish', { page: id, snapshot: portable }, 'POST', owner);
}
