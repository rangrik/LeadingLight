import type { EditorDoc } from "@leadinglight/editor/editor";
import { objects } from "./objects";
import { markSaved, patchSummary } from "./space";

// Pages open in a pane. A change to one of them from elsewhere (linking a mention, merging a
// tag) must go through its editor, or the pane would save its own copy over the change.
type Live = {
  content: () => EditorDoc;
  setContent: (doc: EditorDoc) => void;
  properties: () => Record<string, unknown>;
  setProperties: (props: Record<string, unknown>) => void;
};
const live = new Map<string, Live>();

export function registerLive(id: string, page: Live) {
  live.set(id, page);
  return () => void (live.get(id) === page && live.delete(id));
}

type Change = { content?: (doc: EditorDoc) => EditorDoc; properties?: (props: Record<string, unknown>) => Record<string, unknown> };

export async function editPage(id: string, change: Change) {
  const open = live.get(id);
  if (open) {
    if (change.content) open.setContent(change.content(open.content()));
    if (change.properties) open.setProperties(change.properties(open.properties()));
    return;
  }
  const obj = await objects.get(id);
  if (!obj) return;
  const content = obj.content ? change.content?.(obj.content) : undefined;
  const properties = change.properties?.(obj.properties);
  await objects.update(id, { ...(content && { content }), ...(properties && { properties }) });
  if (properties) patchSummary(id, { properties });
  markSaved();
}
