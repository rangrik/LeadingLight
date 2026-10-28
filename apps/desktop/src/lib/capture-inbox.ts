import type { EditorDoc } from "@leadinglight/editor/editor";
import type { PropDef } from "./catalog";
import { editPage, isLive, liveContent, liveProperties } from "./live";
import { type ObjectSummary, objects } from "./objects";
import { flushAll } from "./saving";
import { pageOf, patchSummary, propOf, putProp, space, typeOf } from "./space";

export type CaptureKind = "idea" | "web" | "voice";
type Capture = { kind: CaptureKind; capturedAt: number; reviewedAt?: number };
const KEY = "captureInbox";
const PROJECT = "capture-project";
export const captureProperties = (kind: CaptureKind) => ({ [KEY]: { kind, capturedAt: Date.now() } });
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

let tagPages: ObjectSummary[] | undefined;
let captureTags = new Set<string>();
export function captureOf(page: ObjectSummary): Capture | undefined {
  const pages = space.get().pages;
  if (tagPages !== pages) {
    tagPages = pages;
    captureTags = new Set(pages.filter((p) => p.typeId === "tag" && p.title.trim().toLowerCase() === "in-the-middle").map((p) => p.id));
  }
  const data = page.properties[KEY] as Partial<Capture> | undefined;
  if (data && ["idea", "web", "voice"].includes(data.kind ?? "") && typeof data.capturedAt === "number" && Number.isFinite(data.capturedAt)) return data as Capture;
  if (typeof page.properties.sourceUrl === "string" && page.properties.capturedAt) return { kind: "web", capturedAt: Date.parse(String(page.properties.capturedAt)) || page.createdAt };
  const tags = ids(page.properties.tags);
  if (page.typeId === "idea" && tags.some((id) => captureTags.has(id))) return { kind: "idea", capturedAt: page.createdAt };
}

// The inbox lists these, and the bar counts the ones to review, so the two never disagree.
export const captured = (pages: ObjectSummary[]) => pages.filter((page) => !page.properties.templateOf && captureOf(page));
export const toReview = (pages: ObjectSummary[]) => captured(pages).filter((page) => !captureOf(page)!.reviewedAt);

// Save the metadata first, then tell an open editor so its next autosave keeps the change.
export async function setCaptureProperty(id: string, key: string, value: unknown) {
  await flushAll();
  const page = pageOf(id);
  if (!page) throw new Error("This page is no longer available.");
  const current = liveProperties(id) ?? page.properties;
  const capture = captureOf(page);
  const legacy = capture && !current[KEY] ? capture : undefined;
  const properties = { ...current, ...(legacy && { [KEY]: legacy }), [key]: value };
  await objects.update(id, { properties });
  if (isLive(id)) await editPage(id, { properties: (props) => ({ ...props, ...(legacy && !props[KEY] && { [KEY]: legacy }), [key]: value }) });
  else patchSummary(id, { properties });
}

export async function markCapture(id: string, kind: CaptureKind) {
  const page = pageOf(id);
  if (!page) return;
  await setCaptureProperty(id, KEY, { kind, capturedAt: Date.now() });
}

export async function setReviewed(id: string, reviewed: boolean) {
  const page = pageOf(id);
  const capture = page && captureOf(page);
  if (!capture) throw new Error("This capture is no longer available.");
  await setCaptureProperty(id, KEY, { ...capture, reviewedAt: reviewed ? Date.now() : undefined });
}

export function captureProject(page: ObjectSummary): PropDef {
  const props = [...typeOf(page.typeId).props, ...Object.keys(page.properties)].map(propOf);
  return props.find((prop) => prop?.kind === "relation" && prop.options.type === "project") ?? propOf(PROJECT) ?? {
    id: PROJECT, name: "Project", kind: "relation", options: { type: "project", reverse: "Captures" }, createdAt: Date.now(),
  };
}

export async function setCaptureProject(page: ObjectSummary, value: string | null) {
  const prop = captureProject(page);
  if (!propOf(prop.id)) await putProp(prop);
  await setCaptureProperty(page.id, prop.id, value ? [value] : []);
}

function hasAudio(doc: EditorDoc | null): boolean {
  return !!doc && ((doc.type === "voiceRecording" && typeof doc.attrs?.src === "string" && !!doc.attrs.src) || !!doc.content?.some(hasAudio));
}
let discovery: Promise<void> | undefined;
export function discoverVoiceCaptures() {
  // One search per session for recordings made before the inbox existed, never a scan per render.
  return discovery ??= objects.containing("voiceRecording").then(async (pages) => {
    for (const page of pages) if (!captureOf(page) && hasAudio(liveContent(page.id) ?? page.content)) await setCaptureProperty(page.id, KEY, { kind: "voice", capturedAt: page.createdAt });
  }).catch((error) => { discovery = undefined; throw error; });
}
