import { Extension, Mark, Node as TiptapNode, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory, undo, redo, undoDepth, redoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Keyboard, TriangleAlert } from "lucide-react";
import { Button } from "@leadinglight/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@leadinglight/ui/components/alert";

export type InkState = { enabled: boolean; tool: "pen" | "eraser"; finger: boolean; canUndo: boolean; canRedo: boolean };
export type InkAction = "toggle" | "pen" | "eraser" | "undo" | "redo" | "finger" | "finish" | "space" | "previous";
type Mode = Pick<InkState, "enabled" | "tool" | "finger">;
type Point = { x: number; y: number; pressure: number };
type Box = { x: number; y: number; width: number; height: number };
type Line = Box & { text: string };
type Anchor = { kind: "text" | "image" | "block"; box: Box; text: string; lines: string[]; src?: string };
type Stroke = { id: string; points: Point[]; anchor: Anchor; snapshot: { width: number; height: number; lines: Line[]; text: string; fontSize: number; image?: { src: string; box: Box } } };
type Ink = { version: 1; strokes: Stroke[] };
type Placed = { stroke: Stroke; box: Box | null };
const modeKey = new PluginKey<Mode>("documentInk");
const initial: Mode = { enabled: false, tool: "pen", finger: false };
let activeEditor: Editor | null = null;
const inputs = new WeakMap<Editor, { finish: () => void; space: () => void; pending: () => boolean }>();
export const hasPendingInk = (editor: Editor) => inputs.get(editor)?.pending() ?? false;
const emptyInk = (): Ink => ({ version: 1, strokes: [] });
const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 50000;
const validBox = (b: Box) => b && [b.x, b.y, b.width, b.height].every(validNumber) && b.width > 0 && b.height > 0;
const checkedInk = new WeakMap<object, boolean>();
const inkOf = (node: PMNode): Ink | null => {
  const value = node.attrs.ink as Ink | null;
  if (value == null) return emptyInk();
  if (typeof value !== "object") return null;
  let valid = checkedInk.get(value);
  if (valid === undefined) {
    let total = 0;
    valid = value.version === 1 && Array.isArray(value.strokes) && value.strokes.length <= 512 && value.strokes.every((s) => {
      if (!s || typeof s.id !== "string" || s.id.length > 100 || !Array.isArray(s.points) || !s.points.length || s.points.length > 4096 || !validBox(s.anchor?.box) || !["text", "image", "block"].includes(s.anchor.kind) || typeof s.anchor.text !== "string" || !Array.isArray(s.anchor.lines) || !s.anchor.lines.every((line) => typeof line === "string")) return false;
      const snap = s.snapshot;
      return (total += s.points.length) <= 65536 && s.points.every((p) => p && [p.x, p.y, p.pressure].every(validNumber) && p.pressure >= 0 && p.pressure <= 1) && snap && validNumber(snap.width) && validNumber(snap.height) && snap.width > 0 && snap.height > 0 && typeof snap.text === "string" && validNumber(snap.fontSize) && snap.fontSize > 0 && Array.isArray(snap.lines) && snap.lines.every((line) => validBox(line) && typeof line.text === "string") && (!snap.image || (typeof snap.image.src === "string" && validBox(snap.image.box)));
    });
    checkedInk.set(value, valid);
  }
  return valid ? value : null;
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const point = (x: number, y: number, pressure = 0.5): Point => ({ x, y, pressure: clamp(pressure || 0.5, 0.05, 1) });
const boxOf = (rect: DOMRect, origin: DOMRect): Box => ({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((r) => r.x)), y = Math.min(...boxes.map((r) => r.y));
  return { x, y, width: Math.max(...boxes.map((r) => r.x + r.width)) - x, height: Math.max(...boxes.map((r) => r.y + r.height)) - y };
};
const overlaps = (a: Box, b: Box) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const fixed = (editor: Editor) => !editor.isEditable || !!editor.view.dom.closest("[data-annotate]");
const modal = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"]')).some((el) => !el.closest('[inert], [aria-hidden="true"], [data-closed]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");

export const hasDocumentInk = (doc: JSONContent | null | undefined): boolean => !!doc && (doc.type === "annotatedBlock" || doc.type === "handwriting" || !!doc.content?.some(hasDocumentInk));
export function rangeHasDocumentInk(editor: Editor, from: number, to: number): boolean {
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => { if (node.type.name === "annotatedBlock" || node.type.name === "handwriting") found = true; return !found; });
  return found;
}
export function getInkState(editor: Editor): InkState {
  return { ...(modeKey.getState(editor.state) ?? initial), canUndo: undoDepth(editor.state) > 0, canRedo: redoDepth(editor.state) > 0 };
}
export function finishPendingInk(editor: Editor) { inputs.get(editor)?.finish(); }
function setMode(editor: Editor, next: Mode) {
  editor.view.dispatch(editor.state.tr.setMeta(modeKey, next).setMeta("addToHistory", false));
}
export function inkAction(editor: Editor, action: InkAction) {
  if (editor.isDestroyed || fixed(editor)) return;
  const state = getInkState(editor);
  if (action === "undo" || action === "redo") { inputs.get(editor)?.finish(); (action === "undo" ? undo : redo)(editor.state, editor.view.dispatch); return; }
  if (action === "space") { inputs.get(editor)?.space(); return; }
  const enabled = action === "finish" ? false : action === "toggle" ? !state.enabled : true;
  if (enabled && activeEditor && activeEditor !== editor && !activeEditor.isDestroyed) inkAction(activeEditor, "finish");
  inputs.get(editor)?.finish();
  if (document.activeElement instanceof HTMLElement && editor.view.dom.closest(".ll-editor-root")?.contains(document.activeElement)) document.activeElement.blur();
  activeEditor = enabled ? editor : activeEditor === editor ? null : activeEditor;
  setMode(editor, { enabled, tool: action === "pen" || action === "eraser" ? action : action === "previous" ? state.tool === "pen" ? "eraser" : "pen" : state.tool, finger: action === "finger" ? !state.finger : state.finger });
  if (enabled) editor.view.dom.ownerDocument.getSelection()?.removeAllRanges();
}

function path(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) { const p = points[0], r = 1 + p.pressure; return `M${p.x-r},${p.y}a${r},${r} 0 1,0 ${r*2},0a${r},${r} 0 1,0 ${-r*2},0`; }
  const sides = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, width = 0.65 + p.pressure * 1.6;
    return [{ x: p.x - dy / length * width, y: p.y + dx / length * width }, { x: p.x + dy / length * width, y: p.y - dx / length * width }];
  });
  return sides.map((p) => p[0]).concat(sides.map((p) => p[1]).reverse()).map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("") + "Z";
}
function rangeRect(editor: Editor, from: number, to: number): DOMRect | null {
  try {
    const a = editor.view.domAtPos(from), b = editor.view.domAtPos(to), range = document.createRange();
    range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  } catch { return null; }
}
function linesOf(editor: Editor, node: PMNode, pos: number, origin: DOMRect, from = pos, to = pos + node.nodeSize): Line[] {
  const lines: Line[] = [];
  node.descendants((child, offset) => {
    if (!child.isText || !child.text) return;
    const start = pos + offset + 1;
    for (let i = Math.max(0, from - start); i < Math.min(child.text.length, to - start); i++) {
      const rect = rangeRect(editor, start + i, start + i + 1);
      if (!rect) continue;
      const box = boxOf(rect, origin), last = lines.at(-1);
      if (last && Math.abs(last.y - box.y) < 2 && Math.abs(last.height - box.height) < 3) { Object.assign(last, union([last, box])); last.text += child.text[i]; }
      else lines.push({ ...box, text: child.text[i] });
    }
  });
  return lines;
}
function markedRange(node: PMNode, pos: number, id: string) {
  let from = Infinity, to = -1, text = "";
  node.descendants((child, offset) => {
    if (child.isText && child.marks.some((mark) => mark.type.name === "inkAnchor" && mark.attrs.id === id)) { from = Math.min(from, pos + offset + 1); to = Math.max(to, pos + offset + 1 + child.nodeSize); text += child.text; }
  });
  return to >= from ? { from, to, text } : null;
}
function placed(editor: Editor, node: PMNode, pos: number, content: HTMLElement): Placed[] {
  const origin = content.getBoundingClientRect();
  return (inkOf(node)?.strokes ?? []).map((stroke) => {
    const a = stroke.anchor;
    if (a.kind === "text") {
      const mark = markedRange(node, pos, stroke.id);
      if (!mark || mark.text !== a.text) return { stroke, box: null };
      const lines = linesOf(editor, node, pos, origin, mark.from, mark.to);
      return { stroke, box: lines.length && JSON.stringify(lines.map((l) => l.text)) === JSON.stringify(a.lines) ? union(lines) : null };
    }
    if (a.kind === "image") {
      const images = Array.from(content.querySelectorAll<HTMLImageElement>("img")).filter((img) => img.getAttribute("src") === a.src);
      return { stroke, box: images.length === 1 ? boxOf(images[0].getBoundingClientRect(), origin) : null };
    }
    const lines = linesOf(editor, node, pos, origin);
    return { stroke, box: node.textContent === a.text && JSON.stringify(lines.map((l) => l.text)) === JSON.stringify(a.lines) ? { x: 0, y: 0, width: origin.width, height: origin.height } : null };
  });
}
const transform = ({ stroke, box }: Placed) => box ? `translate(${box.x} ${box.y}) scale(${box.width / (stroke.anchor.box.width || 1)} ${box.height / (stroke.anchor.box.height || 1)}) translate(${-stroke.anchor.box.x} ${-stroke.anchor.box.y})` : undefined;
function Overlay({ strokes, width, height }: { strokes: Placed[]; width?: number; height?: number }) {
  return <svg className="ll-ink-overlay" aria-label="Handwritten annotations" width={width ?? "100%"} height={height ?? "100%"} style={{ pointerEvents: "none", overflow: "visible" }}><g fill="currentColor">{strokes.filter((p) => p.box).map((p) => <path className="ll-ink-stroke" data-ink-stroke={p.stroke.id} key={p.stroke.id} d={path(p.stroke.points)} transform={transform(p)} />)}</g></svg>;
}
function Review({ strokes }: { strokes: Stroke[] }) {
  if (!strokes.length) return null;
  const near = (a: Box, b: Box) => (["x", "y", "width", "height"] as const).every((key) => Math.abs(a[key] - b[key]) <= 1);
  const same = (a: Stroke["snapshot"], b: Stroke["snapshot"]) => a.text === b.text && a.fontSize === b.fontSize && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1 && a.lines.length === b.lines.length && a.lines.every((line, i) => line.text === b.lines[i].text && near(line, b.lines[i])) && (a.image ? !!b.image && a.image.src === b.image.src && near(a.image.box, b.image.box) : !b.image);
  const groups: Stroke[][] = [];
  for (const stroke of strokes) { const group = groups.find((group) => same(group[0].snapshot, stroke.snapshot)); if (group) group.push(stroke); else groups.push([stroke]); }
  return <Alert className="ll-ink-review" contentEditable={false}><TriangleAlert className="size-4" /><AlertTitle>Review handwriting</AlertTitle><AlertDescription>The words or their layout changed. Your original writing is kept below.{groups.map((group) => {
    const stroke = group[0], s = stroke.snapshot, bounds = union([{ x: 0, y: 0, width: s.width, height: s.height }, ...group.flatMap((v) => v.points.map((p) => ({ ...p, width: 1, height: 1 })))]);
    return <div key={stroke.id} data-ink-review={group.map((v) => v.id).join(" ")}><p className="sr-only">{s.text}</p><svg className="ll-ink-original" aria-label={`Original handwriting: ${s.text || "Drawing"}`} viewBox={`${bounds.x-8} ${bounds.y-8} ${bounds.width+16} ${bounds.height+16}`} style={{ display: "block", width: "100%", maxHeight: 400 }}>{s.image && <image href={s.image.src} x={s.image.box.x} y={s.image.box.y} width={s.image.box.width} height={s.image.box.height} />}<g fill="currentColor" fontSize={s.fontSize}>{s.lines.map((line, i) => <text x={line.x} y={line.y + line.height * 0.8} key={i}>{line.text}</text>)}{group.map((v) => <path key={v.id} d={path(v.points)} />)}</g></svg></div>;
  })}</AlertDescription></Alert>;
}
function AnnotatedView(props: NodeViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Placed[]>([]);
  useLayoutEffect(() => {
    const content = ref.current?.querySelector<HTMLElement>(".ll-ink-content");
    if (!content) return;
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const pos = props.getPos(); if (typeof pos === "number" && !props.editor.isDestroyed) setStrokes(placed(props.editor, props.node, pos, content)); }); };
    const observer = new ResizeObserver(measure); observer.observe(content); content.addEventListener("load", measure, true); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); content.removeEventListener("load", measure, true); };
  }, [props.node, props.editor, props.getPos]);
  return <NodeViewWrapper className="ll-annotated-block" data-ink-block="overlay" ref={ref}><div className="ll-ink-block-surface" style={{ position: "relative" }}><NodeViewContent className="ll-ink-content" /><Overlay strokes={strokes} /></div>{inkOf(props.node) ? <Review strokes={strokes.filter((s) => !s.box).map((s) => s.stroke)} /> : <Alert contentEditable={false}><AlertTitle>Handwriting unavailable</AlertTitle><AlertDescription>This app cannot read this handwriting format. The saved data is unchanged.</AlertDescription></Alert>}</NodeViewWrapper>;
}
function continueTyping(editor: Editor, pos: number) {
  inkAction(editor, "finish");
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const at = pos + node.nodeSize, tr = closeHistory(editor.state.tr);
  const following = tr.doc.nodeAt(at);
  if (following?.type.name !== "paragraph" || following.content.size) tr.insert(at, editor.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView(); editor.view.dispatch(tr); editor.view.focus();
}
function HandwritingView(props: NodeViewProps) {
  const height = clamp(Number(props.node.attrs.height) || 220, 100, 14000), width = clamp(Number(props.node.attrs.width) || 700, 100, 4000);
  const strokes = (inkOf(props.node)?.strokes ?? []).map((stroke) => ({ stroke, box: stroke.anchor.box }));
  return <NodeViewWrapper className="ll-handwriting" data-ink-block="space" contentEditable={false}>
    {!inkOf(props.node) && <Alert><AlertTitle>Handwriting unavailable</AlertTitle><AlertDescription>This app cannot read this handwriting format. The saved data is unchanged.</AlertDescription></Alert>}
    <div className="ll-handwriting-surface" data-ink-space style={{ position: "relative", aspectRatio: `${width}/${height}` }}><svg className="ll-ink-overlay" aria-label="Handwriting" viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "100%", pointerEvents: "none" }}><g fill="currentColor">{strokes.map(({ stroke }) => <path className="ll-ink-stroke" data-ink-stroke={stroke.id} key={stroke.id} d={path(stroke.points)} />)}</g></svg>{!strokes.length && <span className="ll-ink-space-hint">Write here</span>}</div>
    {!fixed(props.editor) && <div data-ink-controls className="ll-ink-space-actions"><Button size="xs" variant="ghost" onClick={() => { const pos = props.getPos(); if (typeof pos === "number") continueTyping(props.editor, pos); }}><Keyboard className="size-4" />Continue typing</Button></div>}
  </NodeViewWrapper>;
}
const inkAttrs = {
  ink: { default: null, parseHTML: (el: HTMLElement) => { try { return JSON.parse(el.getAttribute("data-ink") ?? "null"); } catch { return null; } }, renderHTML: (attrs: Record<string, unknown>) => attrs.ink ? { "data-ink": JSON.stringify(attrs.ink) } : {} },
};
const InkAnchor = Mark.create({ name: "inkAnchor", inclusive: false, excludes: "", keepOnSplit: false, addAttributes: () => ({ id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-ink-anchor"), renderHTML: (attrs: Record<string, unknown>) => ({ "data-ink-anchor": attrs.id }) } }), parseHTML: () => [{ tag: "span[data-ink-anchor]" }], renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0] });
const AnnotatedBlock = TiptapNode.create({ name: "annotatedBlock", group: "block", content: "block+", defining: true, isolating: true, addAttributes: () => inkAttrs, parseHTML: () => [{ tag: 'section[data-type="annotatedBlock"]', contentElement: ".ll-ink-content" }], renderHTML: ({ HTMLAttributes }) => ["section", { ...HTMLAttributes, "data-type": "annotatedBlock" }, ["div", { class: "ll-ink-content" }, 0]], addNodeView: () => ReactNodeViewRenderer(AnnotatedView) });
const Handwriting = TiptapNode.create({ name: "handwriting", group: "block", atom: true, draggable: true, addAttributes: () => ({ ...inkAttrs, height: { default: 220, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-height")) || 220, renderHTML: (attrs: Record<string, unknown>) => ({ "data-height": attrs.height }) }, width: { default: 700, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-width")) || 700, renderHTML: (attrs: Record<string, unknown>) => ({ "data-width": attrs.width }) } }), parseHTML: () => [{ tag: 'div[data-type="handwriting"]' }], renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-type": "handwriting" }], addNodeView: () => ReactNodeViewRenderer(HandwritingView) });
const InkMode = Extension.create({
  name: "documentInkMode",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin<Mode>({ key: modeKey, state: { init: () => initial, apply: (tr, state) => tr.getMeta(modeKey) ?? state }, view: (view) => {
      let last = getInkState(editor);
      const update = () => {
        const state = getInkState(editor), root = view.dom.closest<HTMLElement>(".ll-editor-root") ?? view.dom;
        if (state.enabled) { root.dataset.documentInk = "true"; if (state.finger) root.dataset.inkFinger = "true"; else delete root.dataset.inkFinger; }
        else { delete root.dataset.documentInk; delete root.dataset.inkFinger; }
        if (JSON.stringify(state) === JSON.stringify(last) || (!state.enabled && !last.enabled && state.tool === last.tool && state.finger === last.finger)) { last = state; return; }
        last = state; view.dom.dispatchEvent(new CustomEvent("ll:ink-state", { bubbles: true, detail: state }));
      };
      return { update, destroy: () => { if (activeEditor === editor) activeEditor = null; } };
    } })];
  },
});
export const DocumentInk = [InkAnchor, AnnotatedBlock, Handwriting, InkMode];

type Target = { pos: number; node: PMNode; element: HTMLElement; content: HTMLElement; rect: DOMRect };
type Capture = { snapshot: Stroke["snapshot"]; images: { src: string; box: Box; text: string }[] };
function captureTarget(editor: Editor, target: Target): Capture {
  const { node, pos, rect, content } = target;
  return { snapshot: { width: rect.width, height: rect.height, lines: linesOf(editor, node, pos, rect), text: node.textContent, fontSize: parseFloat(getComputedStyle(content).fontSize) || 16 }, images: Array.from(content.querySelectorAll<HTMLImageElement>("img")).map((image) => ({ src: image.getAttribute("src") ?? "", box: boxOf(image.getBoundingClientRect(), rect), text: image.alt })) };
}
function targetAt(editor: Editor, x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || !editor.view.dom.contains(el) || el.closest("[data-ink-controls], .ll-ink-review, button, input, textarea")) return null;
  return targetFromElement(editor, el);
}
function targetFromElement(editor: Editor, element: HTMLElement): Target | null {
  let el = element;
  while (el.parentElement && el.parentElement !== editor.view.dom) el = el.parentElement;
  if (el.parentElement !== editor.view.dom) return null;
  try {
    const at = editor.view.posAtDOM(el, 0), $at = editor.state.doc.resolve(at), pos = $at.depth ? $at.before(1) : at, node = editor.state.doc.nodeAt(pos);
    if (!node) return null;
    const content = el.querySelector<HTMLElement>(node.type.name === "handwriting" ? ".ll-handwriting-surface" : ".ll-ink-content") ?? el;
    return { pos, node, element: el, content, rect: content.getBoundingClientRect() };
  } catch { return null; }
}
function touches(points: { x: number; y: number }[], x: number, y: number): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const along = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    if (Math.hypot(a.x + dx * along - x, a.y + dy * along - y) < 14) return true;
  }
  return false;
}
function eraserTarget(editor: Editor, x: number, y: number): Target | null {
  for (const path of editor.view.dom.querySelectorAll<SVGPathElement>(".ll-ink-stroke[data-ink-stroke]")) {
    const box = path.getBoundingClientRect();
    if (x < box.left - 14 || x > box.right + 14 || y < box.top - 14 || y > box.bottom + 14) continue;
    const wrapper = path.closest<HTMLElement>("[data-ink-block]"), matrix = path.getScreenCTM();
    if (!wrapper || !matrix) continue;
    const target = targetFromElement(editor, wrapper), saved = target && inkOf(target.node)?.strokes.find((stroke) => stroke.id === path.dataset.inkStroke);
    if (target && saved && touches(saved.points.map((p) => ({ x: p.x * matrix.a + p.y * matrix.c + matrix.e, y: p.x * matrix.b + p.y * matrix.d + matrix.f })), x, y)) return target;
  }
  return null;
}
function insertSpace(editor: Editor, pos: number) {
  if (fixed(editor)) return;
  const node = editor.state.doc.nodeAt(pos), at = node ? pos + node.nodeSize : editor.state.doc.content.size;
  const width = editor.view.dom.clientWidth || 700, tr = closeHistory(editor.state.tr).insert(at, editor.schema.nodes.handwriting.create({ width, height: 220, ink: emptyInk() }));
  tr.setSelection(Selection.near(tr.doc.resolve(at))).scrollIntoView(); editor.view.dispatch(tr); inkAction(editor, "pen");
  requestAnimationFrame(() => (editor.view.nodeDOM(at) as HTMLElement | null)?.scrollIntoView({ block: "nearest" }));
}
function makeStroke(editor: Editor, target: Target, samples: Point[], changed: boolean, capture: Capture): { stroke: Stroke; from?: number; to?: number } {
  const { node, pos, rect } = target, points = samples.map((p) => ({ ...p, x: p.x - rect.left, y: p.y - rect.top })), id = crypto.randomUUID();
  const snapshot = { ...capture.snapshot }, lines = snapshot.lines, text = snapshot.text;
  const whole: Anchor = { kind: "block", box: { x: 0, y: 0, width: rect.width, height: rect.height }, text, lines: lines.map((l) => l.text) };
  const stroke: Stroke = { id, points, anchor: whole, snapshot };
  if (node.type.name === "handwriting") { const scale = (Number(node.attrs.width) || rect.width) / rect.width; stroke.points = points.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale })); stroke.anchor.box = { x: 0, y: 0, width: Number(node.attrs.width) || rect.width, height: Number(node.attrs.height) || rect.height }; return { stroke }; }
  const bounds = union(points.map((p) => ({ ...p, width: 1, height: 1 })));
  const image = capture.images.find((image) => validBox(image.box) && overlaps(bounds, image.box));
  if (image) { stroke.anchor = { kind: "image", src: image.src, box: image.box, text: image.text, lines: [] }; stroke.snapshot.image = { src: image.src, box: image.box }; }
  if (changed) return { stroke: { ...stroke, anchor: { ...whole, text: "\u0000" } } };
  if (image || !target.content.getClientRects().length) return { stroke };
  let from = Infinity, to = -1;
  node.descendants((child, offset) => {
    if (!child.isText || !child.text) return;
    const start = pos + offset + 1;
    for (let i = 0; i < child.text.length; i++) { const r = rangeRect(editor, start + i, start + i + 1); if (r && overlaps(bounds, boxOf(r, rect))) { from = Math.min(from, start + i); to = Math.max(to, start + i + 1); } }
  });
  if (to < from) return { stroke };
  const word = (at: number) => { const next = editor.state.doc.resolve(at).nodeAfter; return !!next?.isText && /^[\p{L}\p{N}_]/u.test(next.text ?? ""); };
  while (from > pos + 1 && word(from - 1) && word(from)) from--;
  while (to < pos + node.nodeSize - 1 && word(to - 1) && word(to)) to++;
  const anchored = linesOf(editor, node, pos, rect, from, to);
  if (!anchored.length) return { stroke };
  stroke.anchor = { kind: "text", box: union(anchored), text: editor.state.doc.textBetween(from, to, ""), lines: anchored.map((l) => l.text) };
  return { stroke, from, to };
}

export function DocumentInkInput({ editor }: { editor: Editor }) {
  const [mode, setState] = useState(() => getInkState(editor));
  const [live, setLive] = useState<Point[]>([]);
  const [issue, setIssue] = useState("");
  const [below, setBelow] = useState<{ pos: number; x: number; y: number } | null>(null);
  const selected = useRef<number | null>(null);
  useEffect(() => {
    const root = editor.view.dom.closest<HTMLElement>(".ll-editor-root") ?? editor.view.dom;
    let stroke: { target: Target; capture: Capture; points: Point[]; pointer: number | null; changed: boolean; detached: boolean; erased: Set<string> } | null = null;
    let frame = 0;
    const render = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setLive(stroke && getInkState(editor).tool === "pen" ? [...stroke.points] : [])); };
    const allowed = () => !editor.isDestroyed && !fixed(editor) && getInkState(editor).enabled && !root.closest("[inert]") && root.getClientRects().length > 0 && (window.visualViewport?.scale ?? 1) === 1 && !modal();
    const finish = () => {
      const done = stroke; stroke = null; cancelAnimationFrame(frame); setLive([]);
      if (!done || !done.points.length || editor.isDestroyed || fixed(editor)) return;
      const { target } = done, current = done.detached ? null : editor.state.doc.nodeAt(target.pos);
      const now = target.content.getBoundingClientRect();
      if (now.width && [now.left - target.rect.left, now.top - target.rect.top, now.width - target.rect.width, now.height - target.rect.height].some((delta) => Math.abs(delta) > 1)) done.changed = true;
      const tr = closeHistory(editor.state.tr);
      if (getInkState(editor).tool === "eraser") {
        if (!current) return;
        const ink = inkOf(current);
        if (!ink || !done.erased.size) return;
        tr.setNodeMarkup(target.pos, undefined, { ...current.attrs, ink: { ...ink, strokes: ink.strokes.filter((s) => !done.erased.has(s.id)) } });
        if (current.type.name === "annotatedBlock") for (const id of done.erased) tr.removeMark(target.pos, target.pos + current.nodeSize, editor.schema.marks.inkAnchor.create({ id }));
      } else {
        const made = makeStroke(editor, target, done.points, done.changed, done.capture);
        if (!current) {
          made.stroke.anchor = { ...made.stroke.anchor, kind: "block", text: "\u0000" };
          tr.insert(tr.doc.content.size, editor.schema.nodes.annotatedBlock.create({ ink: { version: 1, strokes: [made.stroke] } }, editor.schema.nodes.paragraph.create()));
          editor.view.dispatch(tr.setMeta("preserveOrigin", true)); editor.view.dispatch(closeHistory(editor.state.tr));
          setIssue("The block changed while you were writing. Your drawing and its original context are kept at the end of this page."); return;
        }
        const value = inkOf(current);
        if (!value) return;
        const ink = { version: 1, strokes: [...value.strokes, made.stroke] };
        if (current.type.name === "annotatedBlock" || current.type.name === "handwriting") {
          const bottom = Math.max(...made.stroke.points.map((p) => p.y));
          tr.setNodeMarkup(target.pos, undefined, { ...current.attrs, ink, ...(current.type.name === "handwriting" && { height: Math.min(14000, Math.max(current.attrs.height, Math.ceil((bottom + 100) / 100) * 100)) }) });
          if (made.from !== undefined && made.to !== undefined) tr.addMark(made.from, made.to, editor.schema.marks.inkAnchor.create({ id: made.stroke.id }));
        } else {
          tr.replaceWith(target.pos, target.pos + current.nodeSize, editor.schema.nodes.annotatedBlock.create({ ink }, current));
          if (made.from !== undefined && made.to !== undefined) tr.addMark(made.from + 1, made.to + 1, editor.schema.marks.inkAnchor.create({ id: made.stroke.id }));
        }
      }
      editor.view.dispatch(tr.setMeta("preserveOrigin", true)); editor.view.dispatch(closeHistory(editor.state.tr));
    };
    const erase = () => {
      if (!stroke) return;
      const { target, points } = stroke, last = points.at(-1)!;
      if (target.node.type.name !== "annotatedBlock" && target.node.type.name !== "handwriting") return;
      const scale = target.rect.width / (Number(target.node.attrs.width) || target.rect.width);
      const candidates = target.node.type.name === "handwriting" ? (inkOf(target.node)?.strokes ?? []).map((s) => ({ stroke: s, box: { ...s.anchor.box, width: s.anchor.box.width * scale, height: s.anchor.box.height * scale } })) : placed(editor, target.node, target.pos, target.content);
      for (const p of candidates) {
        if (!p.box) continue;
        const a = p.stroke.anchor.box, b = p.box, sx = b.width / (a.width || 1), sy = b.height / (a.height || 1);
        if (touches(p.stroke.points.map((v) => ({ x: target.rect.left + b.x + (v.x - a.x) * sx, y: target.rect.top + b.y + (v.y - a.y) * sy })), last.x, last.y)) stroke.erased.add(p.stroke.id);
      }
    };
    const begin = (p: Point, pointer: number | null) => {
      if (!allowed()) return false;
      const target = (getInkState(editor).tool === "eraser" ? eraserTarget(editor, p.x, p.y) : null) ?? targetAt(editor, p.x, p.y);
      if (!target || !target.rect.width || !target.rect.height || target.rect.height > 50000 || (["annotatedBlock", "handwriting"].includes(target.node.type.name) && !inkOf(target.node))) return false;
      const ink = inkOf(target.node)!;
      if (getInkState(editor).tool === "pen" && (ink.strokes.length >= 512 || ink.strokes.reduce((sum, s) => sum + s.points.length, 0) > 61440)) { setIssue("This handwriting space is full. Choose Write below to continue without changing the saved ink."); return false; }
      finish(); setIssue(""); selected.current = target.pos; setBelow(null); stroke = { target, capture: captureTarget(editor, target), points: [p], pointer, changed: false, detached: false, erased: new Set() }; erase(); render(); return true;
    };
    const add = (samples: Point[]) => {
      if (!stroke) return;
      if (!allowed()) { finish(); return; }
      const r = stroke.target.rect;
      for (const raw of samples) {
        if (![raw.x, raw.y, raw.pressure].every(validNumber)) continue;
        const p = point(clamp(raw.x, r.left - 12, r.right + 12), clamp(raw.y, r.top - 12, r.bottom + 12), raw.pressure), last = stroke.points.at(-1)!;
        if (Math.hypot(last.x - p.x, last.y - p.y) >= 0.5) stroke.points.push(p);
        if (stroke.points.length >= 4096) stroke.points = stroke.points.filter((_, i) => i % 2 === 0 || i === stroke!.points.length - 1);
      }
      erase(); render();
    };
    const hover = (event: PointerEvent) => {
      if (!getInkState(editor).enabled || stroke || modal()) return;
      const target = targetAt(editor, event.clientX, event.clientY);
      if (target && target.node.type.name !== "handwriting") { selected.current = target.pos; setBelow({ pos: target.pos, x: target.rect.right - 108, y: target.rect.bottom + 2 }); }
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.pointerType === "touch" && !getInkState(editor).finger) || (event.pointerType === "pen" && editor.view.dom.dataset.nativeInk === "true")) return;
      if (!allowed() || !(targetAt(editor, event.clientX, event.clientY) || (getInkState(editor).tool === "eraser" && eraserTarget(editor, event.clientX, event.clientY)))) return;
      event.preventDefault(); event.stopImmediatePropagation(); if (begin(point(event.clientX, event.clientY, event.pressure), event.pointerId)) root.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!stroke || stroke.pointer !== event.pointerId) { hover(event); return; }
      event.preventDefault(); event.stopImmediatePropagation(); const samples = event.getCoalescedEvents?.(); add((samples?.length ? samples : [event]).map((p) => point(p.clientX, p.clientY, p.pressure)));
    };
    const up = (event: PointerEvent) => { if (stroke?.pointer !== event.pointerId) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.type !== "pointercancel") add([point(event.clientX, event.clientY, event.pressure)]); finish(); };
    const click = (event: MouseEvent) => { if (getInkState(editor).enabled && !(event.target as HTMLElement)?.closest("[data-ink-controls], .ll-ink-review, button, input, textarea")) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const native = (event: Event) => {
      if (activeEditor !== editor) return;
      const detail = (event as CustomEvent<{ phase: string; points: Point[]; width: number; height: number }>).detail;
      const samples = detail.points.map((p) => point(p.x * innerWidth / (detail.width || innerWidth), p.y * innerHeight / (detail.height || innerHeight), p.pressure));
      if (detail.phase === "began" && samples[0]) begin(samples[0], null); else if (stroke?.pointer === null) add(samples);
      if (detail.phase === "ended" || detail.phase === "cancelled") finish();
    };
    const gesture = (event: Event) => { if (activeEditor !== editor || !allowed()) return; const action = String((event as CustomEvent).detail); if (/eraser/i.test(action)) inkAction(editor, getInkState(editor).tool === "eraser" ? "pen" : "eraser"); else if (/previous/i.test(action)) inkAction(editor, "previous"); };
    const state = () => { const next = getInkState(editor); setState(next); if (!next.enabled) { finish(); setBelow(null); } };
    const transaction = ({ transaction: tr }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (!stroke || !tr.docChanged) return;
      const mapped = tr.mapping.mapResult(stroke.target.pos, 1), old = stroke.target.node;
      stroke.target.pos = mapped.pos;
      if (mapped.deleted) {
        const matches: number[] = []; tr.doc.forEach((node, pos) => { if (node === old) matches.push(pos); });
        if (matches.length === 1) stroke.target.pos = matches[0]; else stroke.detached = true;
      }
      stroke.changed = stroke.detached || !tr.doc.nodeAt(stroke.target.pos)?.eq(old);
      finish();
    };
    const keys = (event: KeyboardEvent) => { if (activeEditor !== editor || !getInkState(editor).enabled || modal()) return; if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) { event.preventDefault(); inkAction(editor, "finish"); } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopImmediatePropagation(); inkAction(editor, event.shiftKey ? "redo" : "undo"); } };
    const hide = () => { if (document.hidden) finish(); };
    const space = () => { finish(); const pos = selected.current ?? (editor.state.selection.$from.depth ? editor.state.selection.$from.before(1) : editor.state.selection.from); insertSpace(editor, pos); };
    const visibility = () => { if (getInkState(editor).enabled && (!root.getClientRects().length || (window.visualViewport?.scale ?? 1) !== 1)) inkAction(editor, "finish"); };
    const scroll = () => { finish(); setBelow(null); };
    const resize = new ResizeObserver(visibility); resize.observe(root);
    inputs.set(editor, { finish, space, pending: () => !!stroke });
    root.addEventListener("pointerdown", down, true); root.addEventListener("pointermove", move, true); root.addEventListener("pointerup", up, true); root.addEventListener("pointercancel", up, true); root.addEventListener("click", click, true);
    editor.view.dom.addEventListener("ll:ink-state", state); editor.on("transaction", transaction);
    window.addEventListener("ll:pencil-input", native); window.addEventListener("ll:pencil-action", gesture); window.addEventListener("keydown", keys, true); window.addEventListener("pagehide", finish); window.addEventListener("scroll", scroll, true); document.addEventListener("visibilitychange", hide); window.visualViewport?.addEventListener("resize", visibility);
    return () => { finish(); inputs.delete(editor); resize.disconnect(); root.removeEventListener("pointerdown", down, true); root.removeEventListener("pointermove", move, true); root.removeEventListener("pointerup", up, true); root.removeEventListener("pointercancel", up, true); root.removeEventListener("click", click, true); editor.view.dom.removeEventListener("ll:ink-state", state); editor.off("transaction", transaction); window.removeEventListener("ll:pencil-input", native); window.removeEventListener("ll:pencil-action", gesture); window.removeEventListener("keydown", keys, true); window.removeEventListener("pagehide", finish); window.removeEventListener("scroll", scroll, true); document.removeEventListener("visibilitychange", hide); window.visualViewport?.removeEventListener("resize", visibility); };
  }, [editor]);
  return <>{issue && <Alert data-ink-controls className="ll-ink-notice"><AlertDescription>{issue}</AlertDescription></Alert>}{mode.enabled && below && createPortal(<Button data-ink-controls aria-label="Write below this block" size="xs" variant="outline" className="ll-ink-write-below" style={{ position: "fixed", left: clamp(below.x, 8, innerWidth - 130), top: Math.min(below.y, innerHeight - 44), zIndex: 20 }} onMouseDown={(e) => e.preventDefault()} onClick={() => { insertSpace(editor, below.pos); setBelow(null); }}><ArrowDown className="size-4" />Write below</Button>, document.body)}{live.length > 0 && createPortal(<svg className="ll-ink-live" aria-hidden style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 30, color: "var(--foreground)" }}><path d={path(live)} fill="currentColor" /></svg>, document.body)}</>;
}
