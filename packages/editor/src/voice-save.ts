import type { JSONContent } from "@tiptap/core";
import type { Asset } from "./assets";

// Attach only to the stopped take that still exists, using the page's latest words.
export function attachVoiceAsset(doc: JSONContent, recordingId: string, asset: Asset): JSONContent | null {
  let attached = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === "voiceRecording" && node.attrs?.recordingId === recordingId && !node.attrs.src) {
      attached = true;
      return { ...node, attrs: { ...node.attrs, src: asset.url, name: asset.name, mime: asset.mime, size: asset.size, autostart: false } };
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  const next = walk(doc);
  return attached ? next : null;
}
