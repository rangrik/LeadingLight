import { htmlDoc, type EditorDoc } from "@leadinglight/editor/editor";
import type { Asset } from "@leadinglight/editor/assets";
import { assets } from "./assets";
import { createPage, forgetPage } from "./space";
import { objects } from "./objects";
import { MAX_ASSET_BYTES } from "./sync-assets";

type Section = { title: string; content: EditorDoc[] };
export type ReadingSource = { source?: string; asset?: Asset; url?: string; book?: string; previous?: string; next?: string };
export const readingSource = (value: unknown): ReadingSource | undefined => value && typeof value === "object" ? value as ReadingSource : undefined;
const paragraph = (text: string): EditorDoc => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const heading = (text: string): EditorDoc => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const imageNode = (image: Asset): EditorDoc => ({ type: "image", attrs: { src: image.url, name: image.name, mime: image.mime, size: image.size } });

async function pdfSections(file: File, password: string, progress: (text: string) => void): Promise<Section[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password });
  try {
    const pdf = await loading.promise;
    const sections: Section[] = [];
    let scannedBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      progress(`Reading page ${number} of ${pdf.numPages}…`);
      if ((number - 1) % 10 === 0) sections.push({ title: `Pages ${number}–${Math.min(number + 9, pdf.numPages)}`, content: [] });
      const section = sections.at(-1)!;
      section.content.push(heading(`Page ${number}`));
      const page = await pdf.getPage(number);
      const text = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of text.items) {
        if (!("str" in item)) continue;
        line += item.str + " ";
        if (item.hasEOL) { lines.push(line.trim()); line = ""; }
      }
      if (line.trim()) lines.push(line.trim());
      if (lines.some((value) => value.trim())) {
        section.content.push(...lines.filter(Boolean).map(paragraph));
      } else {
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2000 / Math.max(size.width, size.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Couldn't save a scanned page.")), "image/png"));
        scannedBytes += blob.size;
        if (scannedBytes > 96 * 1024 * 1024) throw new Error("The scanned pages exceed 96 MiB. Split this PDF into smaller volumes and try again.");
        section.content.push(imageNode(await assets.put(new File([blob], `Page ${number}.png`, { type: "image/png" }))));
        canvas.width = canvas.height = 0;
        section.content.push(paragraph("Scanned page. Select the image and choose Extract text in the Mac, iPad or iPhone app."));
      }
      page.cleanup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return sections;
  } catch (error) {
    const failure = error as { name?: string; code?: number };
    if (failure.name === "PasswordException") throw new Error(failure.code === 2 ? "That PDF password did not work. Enter its password and choose the file again." : "This PDF needs a password. Enter it, then choose the file again.");
    if (failure.name === "InvalidPDFException") throw new Error("This PDF could not be read. Try opening it in Preview and exporting a fresh PDF.");
    throw error;
  } finally { await loading.destroy(); }
}

async function epubSections(file: File, progress: (text: string) => void): Promise<Section[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let total = 0, count = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => {
    total += entry.originalSize; count++;
    if (total > 96 * 1024 * 1024 || entry.originalSize > MAX_ASSET_BYTES || count > 5000) throw new Error("This EPUB expands beyond the import limit. Split it into smaller books.");
    return true;
  } });
  const xml = (name: string) => {
    if (!files[name]) throw new Error(`The EPUB is missing ${name}.`);
    const document = new DOMParser().parseFromString(strFromU8(files[name]), "application/xml");
    if (document.querySelector("parsererror")) throw new Error(`The EPUB contains unreadable markup in ${name}.`);
    return document;
  };
  if (files["META-INF/encryption.xml"]) {
    const encryption = xml("META-INF/encryption.xml");
    const protectedContent = [...encryption.getElementsByTagNameNS("*", "EncryptionMethod")].some((entry) => !["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"].includes(entry.getAttribute("Algorithm") ?? ""));
    if (protectedContent) throw new Error("This EPUB is protected. Open it in Kindle, Libby or its authorized reader, and keep your reading notes here.");
  }
  const packagePath = xml("META-INF/container.xml").getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) throw new Error("This file is not a readable EPUB.");
  const packageDoc = xml(packagePath);
  const items = new Map([...packageDoc.getElementsByTagNameNS("*", "item")].map((item) => [item.getAttribute("id"), item]));
  const resolve = (path: string, base: string) => {
    const url = new URL(path, `https://epub.local/${base}`);
    if (url.origin !== "https://epub.local") return null;
    return decodeURIComponent(url.pathname.slice(1));
  };
  const sections: Section[] = [];
  const images = new Map<string, Asset>();
  const spine = [...packageDoc.getElementsByTagNameNS("*", "itemref")];
  for (const [index, reference] of spine.entries()) {
    const item = items.get(reference.getAttribute("idref"));
    const href = item?.getAttribute("href");
    const path = href && resolve(href, packagePath);
    if (!path) throw new Error("An EPUB chapter has an invalid address.");
    progress(`Reading chapter ${index + 1} of ${spine.length}…`);
    const document = xml(path);
    const body = document.getElementsByTagNameNS("*", "body")[0];
    if (!body) continue;
    const blocked = new Set(["script", "style", "link", "iframe", "object", "embed", "form", "input", "button", "audio", "video", "svg", "math"]);
    body.querySelectorAll("*").forEach((element) => { if (blocked.has(element.localName.toLowerCase())) element.remove(); });
    for (const element of body.querySelectorAll("*")) {
      const src = element.getAttribute("src");
      const href = element.getAttribute("href");
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (element.localName.toLowerCase() === "a" && href && /^https?:\/\//i.test(href)) element.setAttribute("href", href);
      if (element.localName.toLowerCase() !== "img") continue;
      const imagePath = src && resolve(src, path);
      const mime = imagePath?.match(/\.(png|jpe?g|gif|webp|avif)$/i)?.[1]?.toLowerCase();
      if (!imagePath || !mime || !files[imagePath]) { element.remove(); continue; }
      let image = images.get(imagePath);
      if (!image) {
        image = await assets.put(new File([Uint8Array.from(files[imagePath])], imagePath.split("/").at(-1)!, { type: `image/${mime === "jpg" ? "jpeg" : mime}` }));
        images.set(imagePath, image);
      }
      element.setAttribute("src", image.url); element.setAttribute("name", image.name); element.setAttribute("mime", image.mime); element.setAttribute("size", String(image.size));
    }
    const plain = globalThis.document.createElement("div");
    const copy = (node: Node): Node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return globalThis.document.createTextNode(node.textContent ?? "");
      const source = node as Element;
      const element = globalThis.document.createElement(source.localName);
      for (const attr of [...source.attributes]) element.setAttribute(attr.name, attr.value);
      source.childNodes.forEach((child) => element.append(copy(child)));
      return element;
    };
    body.childNodes.forEach((child) => plain.append(copy(child)));
    const title = plain.querySelector("h1,h2,h3")?.textContent?.trim() || `Chapter ${index + 1}`;
    const content = htmlDoc(plain.innerHTML).content ?? [];
    for (let offset = 0; offset < content.length; offset += 300) sections.push({ title: offset ? `${title} (continued)` : title, content: content.slice(offset, offset + 300) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!sections.length) throw new Error("This EPUB has no readable chapters.");
  return sections;
}

export async function importBook(file: File, password: string, progress: (text: string) => void) {
  if (file.size > MAX_ASSET_BYTES) throw new Error("Choose a book under 32 MiB so its original file can sync to your other devices.");
  const format = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".epub") ? "epub" : null;
  if (!format) throw new Error("Choose a PDF or an unencrypted EPUB. Kindle purchases and Libby loans can use a linked reading notebook.");
  const sections = await (format === "pdf" ? pdfSections(file, password, progress) : epubSections(file, progress));
  const original = await assets.put(new File([file], file.name, { type: format === "pdf" ? "application/pdf" : "application/epub+zip" }));
  const book = crypto.randomUUID(), ids = sections.map(() => crypto.randomUUID());
  const created: string[] = [];
  try {
    for (const [index, section] of sections.entries()) {
      progress(`Saving section ${index + 1} of ${sections.length}…`);
      await createPage({ id: ids[index], title: section.title, content: { type: "doc", content: section.content }, properties: { parent: book, reading: { book, previous: ids[index - 1], next: ids[index + 1] } } });
      created.push(ids[index]);
    }
    const root = await createPage({ id: book, typeId: "book", title: file.name.replace(/\.(pdf|epub)$/i, ""), properties: { "book-status": ["reading"], reading: { source: format, asset: original } }, content: { type: "doc", content: [
      paragraph("Read a section below. Highlight words or add sidenotes as you would on any page. The original file keeps its exact layout."),
      { type: "file", attrs: { src: original.url, name: original.name, mime: original.mime, size: original.size } },
      ...ids.map((id) => ({ type: "pageLink", attrs: { id } })),
    ] } });
    return root.id;
  } catch (error) {
    for (const id of created) { await objects.remove(id); forgetPage(id); }
    throw error;
  }
}
