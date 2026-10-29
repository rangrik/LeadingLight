import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserInspection } from "~/components/browser-feedback";
import type { BrowserAreaSelection, BrowserViewport } from "~/components/browser-surface";
import { annotationImageName, type BrowserAnnotation, type BrowserRectangle } from "./browser-context.ts";
import { safeBrowserURL } from "./browser-data.ts";
import { createStore } from "./state.ts";
import { ask } from "~/lib/project-runtime/transport";

export type BrowserAreaCapture = {
  url: string; bounds: BrowserRectangle; viewport: BrowserViewport; capturedAt: string;
  screenshot: { name: string; mime: "image/png" };
};
const KEY = "ll.browser.annotations.v1";
const MAX_STORED_CHARS = 2 * 1024 * 1024;
const pageKey = (base: string, url: string) => JSON.stringify([base, url]);
function valid(note: BrowserAnnotation) {
  if (!note || typeof note.id !== "string" || typeof note.comment !== "string" || note.comment.length > 2000 || !annotationImageName(note.screenshot?.name ?? "") || note.screenshot?.mime !== "image/png" || typeof note.screenshot.capturedAt !== "string") return false;
  if (note.element) {
    const element = note.element;
    if (typeof element.tag !== "string" || typeof element.text !== "string" || (element.selector !== undefined && typeof element.selector !== "string") || !safeBrowserURL(element.url)) return false;
    if (element.frame && (typeof element.frame.url !== "string" || !Array.isArray(element.frame.path) || !element.frame.path.every((part) => typeof part === "string"))) return false;
  } else if (!note.area || !safeBrowserURL(note.area.url) || !note.area.bounds || !note.area.viewport || ![...Object.values(note.area.bounds), ...Object.values(note.area.viewport)].every(Number.isFinite)) return false;
  return !note.styles || Object.values(note.styles).every((value) => typeof value === "string");
}
function load(): Record<string, BrowserAnnotation[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > MAX_STORED_CHARS) return {};
    const data = JSON.parse(raw) as Record<string, BrowserAnnotation[]>;
    return Object.fromEntries(Object.entries(data).flatMap(([key, notes]) => {
      const kept = Array.isArray(notes) ? notes.filter(valid).slice(0, 20) : [];
      return kept.length ? [[key, kept]] : [];
    }).slice(0, 200));
  } catch { return {}; }
}
const saved = createStore(load());
function write(next: Record<string, BrowserAnnotation[]>) {
  const raw = JSON.stringify(next);
  if (raw.length > MAX_STORED_CHARS) throw new Error("Saved browser comments are full. Remove old comments before saving another.");
  localStorage.setItem(KEY, raw);
  saved.set(next);
}
function useSavedComments() {
  const all = saved.use();
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === KEY) saved.set(load()); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return all;
}
export function useSavedBrowserComments() {
  const all = useSavedComments();
  return { count: Object.values(all).reduce((total, notes) => total + notes.length, 0), clearAll: () => write({}) };
}
export function useBrowserAnnotations(base: string, _tab: string, url: string) {
  const all = useSavedComments();
  const key = pageKey(base, url);
  return {
    comments: all[key] ?? [],
    save(annotation: BrowserAnnotation) {
      const before = saved.get();
      if ((before[key]?.length ?? 0) >= 20) throw new Error("This page has 20 comments. Remove a comment before saving another.");
      if (Object.values(before).reduce((total, notes) => total + notes.length, 0) >= 200) throw new Error("There are 200 saved browser comments. Remove old comments before saving another.");
      if ((annotation.element?.url ?? annotation.area?.url) !== url || !annotationImageName(annotation.screenshot?.name ?? "")) throw new Error("The page changed. Select it again before saving a comment.");
      const note = structuredClone({ ...annotation, id: crypto.randomUUID() });
      write({ ...before, [key]: [...(before[key] ?? []), note] });
      return note;
    },
    remove(id: string) { const next = { ...saved.get() }; const kept = (next[key] ?? []).filter((note) => note.id !== id); if (kept.length) next[key] = kept; else delete next[key]; write(next); },
    clear() { const next = { ...saved.get() }; delete next[key]; write(next); },
  };
}

export async function captureArea(base: string, tab: string, selection: BrowserAreaSelection): Promise<BrowserAreaCapture> {
  const capture = await ask<BrowserAreaCapture>("POST", `${base}/inspect/area?tab=${encodeURIComponent(tab)}`, { ...selection.bounds, viewport: selection.viewport, expectedURL: selection.url });
  if (capture.url !== selection.url || !annotationImageName(capture.screenshot?.name ?? "") || capture.screenshot.mime !== "image/png" || typeof capture.capturedAt !== "string") throw new Error("The browser did not return a screenshot of this page.");
  return { url: capture.url, bounds: capture.bounds, viewport: capture.viewport, capturedAt: capture.capturedAt, screenshot: { name: capture.screenshot.name, mime: capture.screenshot.mime } };
}
export async function captureElementComment(base: string, tab: string, selected: BrowserInspection, viewport: BrowserViewport, comment: string, styles: Record<string, string>, lease?: string): Promise<BrowserAnnotation> {
  const capture = await ask<BrowserAreaCapture & { element: Omit<BrowserInspection, "handle"> }>("POST", `${base}/inspect/area?tab=${encodeURIComponent(tab)}`, { handle: selected.handle, lease, viewport, expectedURL: selected.url });
  const inspection = capture.element;
  if (capture.url !== selected.url || inspection?.url !== selected.url || !annotationImageName(capture.screenshot?.name ?? "") || capture.screenshot.mime !== "image/png" || typeof capture.capturedAt !== "string") throw new Error("The browser did not return a screenshot of this element.");
  return { comment, element: { tag: inspection.tag, text: inspection.text, selector: inspection.selector, url: inspection.url, frame: inspection.frame }, styles: { ...styles }, screenshot: { name: capture.screenshot.name, mime: capture.screenshot.mime, capturedAt: capture.capturedAt } };
}

// A lease ends even when the viewer crashes before it can send Reset.
export function useBrowserAnnotationLease(base: string, tab: string, active: boolean) {
  const [lease, setLease] = useState<string>();
  const [error, setError] = useState("");
  const state = useRef<{ key: string; lease?: string; pending?: Promise<string> }>({ key: "" });
  const key = `${base}?tab=${encodeURIComponent(tab)}`;
  const ensure = useCallback(async () => {
    const current = state.current;
    if (current.key !== key) throw new Error("The browser tab changed. Select it again.");
    if (current.lease) return current.lease;
    if (!current.pending) current.pending = ask<{ lease: string }>("POST", `${base}/inspect/lease?tab=${encodeURIComponent(tab)}`, {}).then((answer) => {
      if (!answer.lease) throw new Error("The browser did not open a preview session.");
      if (state.current !== current) {
        void ask("DELETE", `${base}/inspect/lease?tab=${encodeURIComponent(tab)}`, { lease: answer.lease }).catch(() => {});
        throw new Error("The browser tab changed. Select it again.");
      }
      current.lease = answer.lease; setLease(answer.lease); setError(""); return answer.lease;
    }).finally(() => { current.pending = undefined; });
    return current.pending;
  }, [base, key, tab]);
  useEffect(() => {
    if (state.current.key !== key) state.current = { key };
    const current = state.current;
    setLease(current.lease); setError("");
    if (!active || !tab) return;
    void ensure().catch((reason) => { if (state.current === current) setError(String(reason.message ?? reason)); });
    const timer = window.setInterval(() => {
      if (!current.lease) return;
      void ask("POST", `${base}/inspect/lease?tab=${encodeURIComponent(tab)}`, { lease: current.lease }).catch((reason) => { if (state.current === current) setError(String(reason.message ?? reason)); });
    }, 5000);
    return () => {
      window.clearInterval(timer); state.current = { key: "" };
      if (current.lease) void ask("DELETE", `${base}/inspect/lease?tab=${encodeURIComponent(tab)}`, { lease: current.lease }).catch(() => {});
    };
  }, [active, base, ensure, key, tab]);
  return { lease, ensure, error };
}
