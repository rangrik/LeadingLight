import type { EditorDoc } from '@leadinglight/editor/editor';

export type PublishedSnapshot = { version: 1; style?: 'plain' | 'playful'; title: string; description: string; content: EditorDoc; notes: { id: string; body: EditorDoc }[] };
export type Publication = { url: string; updatedAt: string };
export const publicLink = (url: unknown): url is string => typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url);

function publicEmbed(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:') return null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([^/]+)$/.exec(url.pathname)?.[1];
      if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      const id = /^\/(?:video\/)?(\d+)$/.exec(url.pathname)?.[1];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch { /* Invalid links become plain text. */ }
  return null;
}

// Publish what the page shows, without local paths, authorship history or private page targets.
export function publishedDoc(doc: EditorDoc, label: (id: string) => string = () => 'Private page'): EditorDoc {
  if (doc.type === 'embed' && typeof doc.attrs?.src === 'string') {
    const src = doc.attrs.src;
    const video = publicEmbed(src);
    if (!video) return { type: 'paragraph', content: [{ type: 'text', text: publicLink(src) ? src : 'Embedded content unavailable', ...(publicLink(src) ? { marks: [{ type: 'link', attrs: { href: src } }] } : {}) }] };
    doc = { ...doc, attrs: { ...doc.attrs, src: video } };
  }
  if (doc.type === 'mention' || doc.type === 'cite') return { type: 'text', text: doc.attrs?.label || label(doc.attrs?.id) || 'Private page' };
  if (doc.type === 'pageLink') return { type: 'paragraph', content: [{ type: 'text', text: label(doc.attrs?.id) || 'Private page' }] };
  const attrs = doc.attrs ? { ...doc.attrs } : undefined;
  if (attrs) {
    delete attrs.origin; delete attrs.authorship; delete attrs.drawing; delete attrs.autoExtract;
    if (doc.type === 'thought') { delete attrs.page; delete attrs.href; delete attrs.source; }
    for (const key of ['href', 'src', 'url']) {
      if (typeof attrs[key] === 'string' && !publicLink(attrs[key]) && !(key !== 'href' && /^data:[\w.+/-]+;base64,[a-z\d+/=]*$/i.test(attrs[key]))) delete attrs[key];
    }
  }
  return {
    type: doc.type, ...(doc.text !== undefined ? { text: doc.text } : {}), ...(attrs ? { attrs } : {}),
    ...(doc.content ? { content: doc.content.map((child) => publishedDoc(child, label)) } : {}),
    ...(doc.marks ? { marks: doc.marks.filter((mark) => !['origin', 'cited'].includes(mark.type) && (mark.type !== 'link' || publicLink(mark.attrs?.href ?? ''))).map((mark) => ({ ...publishedDoc(mark, label), type: mark.type })) } : {}),
  };
}

export function publishedNotes(content: EditorDoc, thoughts: EditorDoc): PublishedSnapshot['notes'] {
  const ids = new Set<string>(), bodies = new Map<string, EditorDoc>();
  const visit = (node: EditorDoc, fn: (node: EditorDoc) => void) => { fn(node); node.content?.forEach((child) => visit(child, fn)); };
  visit(content, (node) => node.marks?.forEach((mark) => { if (mark.type === 'note' && typeof mark.attrs?.id === 'string') ids.add(mark.attrs.id); }));
  visit(thoughts, (node) => { if (node.type === 'thought') bodies.set(node.attrs?.id, { type: 'doc', content: node.content ?? [] }); });
  return [...ids].filter((id) => bodies.has(id)).map((id) => ({ id, body: bodies.get(id)! }));
}

// A bad or newer server response should show an error instead of crashing the reader.
export function isPublishedSnapshot(value: unknown): value is PublishedSnapshot {
  let left = 40000;
  const doc = (value: unknown, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 64 || --left < 0) return false;
    const node = value as EditorDoc;
    return typeof node.type === 'string' && (node.text === undefined || typeof node.text === 'string')
      && (node.attrs === undefined || !!node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs))
      && (node.content === undefined || Array.isArray(node.content) && node.content.every((child) => doc(child, depth + 1)))
      && (node.marks === undefined || Array.isArray(node.marks) && node.marks.every((mark) => doc(mark, depth + 1)));
  };
  const page = value as PublishedSnapshot | null;
  return !!page && page.version === 1 && typeof page.title === 'string' && typeof page.description === 'string'
    && page.content?.type === 'doc' && doc(page.content) && Array.isArray(page.notes) && page.notes.length <= 2000
    && page.notes.every((note) => note && typeof note.id === 'string' && note.body?.type === 'doc' && doc(note.body));
}
