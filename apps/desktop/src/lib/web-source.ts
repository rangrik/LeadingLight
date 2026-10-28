import { captureProperties } from "./capture-inbox";
import { Readability } from "@mozilla/readability";
import type { EditorDoc } from "@leadinglight/editor/editor";
import type { Asset } from "@leadinglight/editor/assets";
import { assets } from "./assets";
import { isNative } from "./platform";
import { createPage } from "./space";

export type SourceMode = "link" | "text" | "media";
const HTML_LIMIT = 8 * 1024 * 1024;
const MEDIA_LIMIT = 20 * 1024 * 1024;

export function sourceUrl(value: string, base?: string): string {
  const url = new URL(value.trim(), base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an http or https address without a username or password.");
  }
  return url.href;
}

const text = (value: string, marks?: EditorDoc["marks"]): EditorDoc => ({ type: "text", text: value, ...(marks?.length ? { marks } : {}) });
const paragraph = (value: string): EditorDoc => ({ type: "paragraph", content: value ? [text(value)] : [] });
export const link = (label: string, href: string): EditorDoc => ({ type: "paragraph", content: [text(label, [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } }])] });

// Only known editor nodes cross this boundary; website HTML never enters the live document.
export function readArticle(html: string, address: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("base").forEach((el) => el.remove());
  const base = doc.createElement("base");
  base.href = address;
  doc.head.append(base);
  const title = doc.title.trim();
  for (const frame of doc.querySelectorAll("iframe")) {
    try {
      const href = sourceUrl(frame.getAttribute("src") ?? "", address);
      const a = doc.createElement("a");
      a.href = href;
      a.textContent = "Embedded media (link)";
      const p = doc.createElement("p");
      p.append(a);
      frame.replaceWith(p);
    } catch { frame.remove(); }
  }
  doc.querySelectorAll("script,style,noscript,form,button,input,textarea,select,iframe,object,embed,svg,[hidden],[aria-hidden='true']").forEach((el) => el.remove());
  const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 0, maxElemsToParse: 50_000 }).parse();
  // Readability can discard short lists and media even inside an explicit article.
  const root = doc.querySelector("article,main") ?? (article?.content
    ? new DOMParser().parseFromString(article.content, "text/html").body
    : doc.body);
  const media: EditorDoc[] = [];
  const urlOf = (value: string | null) => { try { return value ? sourceUrl(value, address) : null; } catch { return null; } };
  const ignored = new Set(["script", "style", "iframe", "form", "nav", "source"]);
  const inlineTags = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "del", "em", "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "img", "audio", "video"]);
  const inline = (node: Node, marks: NonNullable<EditorDoc["marks"]> = []): EditorDoc[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [text(node.textContent.replace(/\s+/g, " "), marks)] : [];
    if (!(node instanceof Element)) return [];
    const tag = node.tagName.toLowerCase();
    if (ignored.has(tag)) return [];
    if (["img", "audio", "video"].includes(tag)) {
      const srcset = node.getAttribute("srcset") || node.getAttribute("data-srcset") || node.closest("picture")?.querySelector("source")?.getAttribute("srcset");
      const src = [node.getAttribute("src"), node.getAttribute("data-src"), node.querySelector("source")?.getAttribute("src"), srcset?.split(",")[0]?.trim().split(/\s+/)[0]].map((value) => urlOf(value ?? null)).find(Boolean);
      const saved: EditorDoc = { type: tag === "img" ? "image" : tag, attrs: { src: src ?? null, name: node.getAttribute("alt") || tag } };
      media.push(saved);
      return [saved];
    }
    if (tag === "br") return [{ type: "hardBreak" }];
    const mark = ({ b: "bold", strong: "bold", i: "italic", em: "italic", u: "underline", s: "strike", del: "strike", code: "code" } as Record<string, string>)[tag];
    const href = tag === "a" ? urlOf(node.getAttribute("href")) : null;
    const added = mark ? { type: mark } : href ? { type: "link", attrs: { href } } : null;
    const next = added ? [...marks.filter((m) => m.type !== added.type), added] : marks;
    return [...node.childNodes].flatMap((n) => inline(n, next));
  };
  // Media blocks split a line in place; neither the words before nor after are lost.
  const lines = (nodes: EditorDoc[], type = "paragraph", attrs?: EditorDoc["attrs"]): EditorDoc[] => {
    const result: EditorDoc[] = [];
    let content: EditorDoc[] = [];
    const flush = () => {
      if (content.some((n) => n.text?.trim())) result.push({ type, ...(attrs && { attrs }), content });
      content = [];
    };
    for (const node of nodes) {
      if (["image", "audio", "video"].includes(node.type ?? "")) { flush(); result.push(node); }
      else content.push(node);
    }
    flush();
    return result;
  };
  const blocks = (parent: Element): EditorDoc[] => {
    const result: EditorDoc[] = [];
    let pending: EditorDoc[] = [];
    const flush = () => { result.push(...lines(pending)); pending = []; };
    for (const child of parent.childNodes) {
      if (!(child instanceof Element) || inlineTags.has(child.tagName.toLowerCase())) { pending.push(...inline(child)); continue; }
      flush();
      const tag = child.tagName.toLowerCase();
      if (ignored.has(tag)) continue;
      if (tag === "hr") result.push({ type: "horizontalRule" });
      else if (tag === "pre") result.push({ type: "codeBlock", content: child.textContent ? [text(child.textContent)] : [] });
      else if (["ul", "ol"].includes(tag)) {
        const items = [...child.children].filter((n) => n.tagName === "LI").map((li) => {
          const content = blocks(li);
          if (content[0]?.type !== "paragraph") content.unshift(paragraph(""));
          return { type: "listItem", content };
        });
        if (items.length) result.push({ type: tag === "ul" ? "bulletList" : "orderedList", ...(tag === "ol" && { attrs: { start: Number.parseInt(child.getAttribute("start") ?? "1", 10) || 1 } }), content: items });
      } else if (tag === "blockquote") {
        const content = blocks(child);
        if (content.length) result.push({ type: "blockquote", content });
      } else if (/^h[1-6]$/.test(tag)) result.push(...lines(inline(child), "heading", { level: Math.min(3, Number(tag[1])) }));
      else result.push(...blocks(child));
    }
    flush();
    return result;
  };
  const content = blocks(root);
  if (!content.length) throw new Error("No readable content was found. Save the link instead.");
  return { title: article?.title?.trim() || title || new URL(address).hostname, content, media };
}

async function browserFetch(url: string, limit: number, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(url, { credentials: "omit", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`The website returned ${response.status}. Save the link instead.`);
  if (Number(response.headers.get("content-length")) > limit) throw new Error("This download is too large. Save the link instead.");
  return response;
}

async function boundedBody(response: Response, limit: number): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The website returned an empty response.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("This download is too large. Save the link instead."); }
    chunks.push(value);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
}

async function fetchArticle(url: string, signal?: AbortSignal) {
  if (await isNative) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ url: string; html: string }>("web_fetch", { url });
  }
  const response = await browserFetch(url, HTML_LIMIT, signal);
  if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")) throw new Error("This address is not a webpage. Save the link instead.");
  return { url: sourceUrl(response.url), html: await (await boundedBody(response, HTML_LIMIT)).text() };
}

async function keepMedia(url: string, signal?: AbortSignal): Promise<Asset> {
  if (await isNative) {
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    const saved = await invoke<Asset>("web_save_media", { url });
    return { ...saved, url: convertFileSrc(saved.url) };
  }
  const response = await browserFetch(url, MEDIA_LIMIT, signal);
  const blob = await boundedBody(response, MEDIA_LIMIT);
  if (!/^(image|audio|video)\//.test(blob.type) || blob.type.includes("svg")) throw new Error("Not a supported media file");
  return assets.put(new File([blob], new URL(url).pathname.split("/").pop() || "media", { type: blob.type }));
}

export async function saveWebSource(value: string, mode: SourceMode, options: { signal?: AbortSignal; onCommit?: () => void } = {}) {
  const { signal } = options;
  signal?.throwIfAborted();
  const url = sourceUrl(value);
  let title = new URL(url).hostname;
  let content: EditorDoc[] = [];
  let missing = 0;
  if (mode !== "link") {
    const fetched = await fetchArticle(url, signal);
    signal?.throwIfAborted();
    const article = readArticle(fetched.html, fetched.url);
    title = article.title;
    content = article.content;
    const savedMedia = new Map<string, Promise<Asset>>();
    let next = 0;
    const keepNext = async () => { while (next < article.media.length) {
      signal?.throwIfAborted();
      const index = next++;
      const node = article.media[index];
      const src = node.attrs!.src as string | null;
      const description = String(node.attrs!.name);
      if (mode === "text") { Object.assign(node, paragraph("")); delete node.attrs; continue; }
      try {
        if (!src || index >= 30) throw new Error("Media unavailable");
        if (!savedMedia.has(src)) savedMedia.set(src, keepMedia(src, signal));
        const saved = await savedMedia.get(src)!;
        signal?.throwIfAborted();
        node.attrs = { src: saved.url, name: description === "img" || description === node.type ? saved.name : description, mime: saved.mime, size: saved.size };
      } catch {
        signal?.throwIfAborted();
        missing++;
        Object.assign(node, src ? link(`Media not saved: ${src}`, src) : paragraph(`Media not saved: ${description} (unsupported address)`));
        delete node.attrs;
      }
    } };
    await Promise.all(Array.from({ length: Math.min(3, article.media.length) }, keepNext));
  }
  signal?.throwIfAborted();
  options.onCommit?.();
  const page = await createPage({ title, properties: { ...captureProperties("web"), sourceUrl: url, capturedAt: new Date().toISOString(), sourceMode: mode }, content: { type: "doc", content: [link(url, url), ...content, paragraph("")] } });
  return { page, missing };
}
