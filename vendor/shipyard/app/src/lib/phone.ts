import type { Client } from "@/lib/api";

// Phone access, served by each box on its tailnet address (see
// internal/box/phone.go). A paired laptop turns it on and reads its token
// over the authenticated box API; the phone gets it from a QR code.

export interface PhoneNotify {
  url: string;
  on?: ("waiting" | "finished")[];
}

export interface PhoneStatus {
  enabled: boolean;
  token?: string;
  notify?: PhoneNotify;
  url?: string;
  error?: string;
}

export interface PhoneChange {
  enabled?: boolean;
  rotate?: boolean;
  notify?: PhoneNotify;
  clear_notify?: boolean;
}

export const phoneApi = {
  status: (c: Client, box: string) => c.box<PhoneStatus>(box, "GET", "phone"),
  change: (c: Client, box: string, change: PhoneChange) => c.box<PhoneStatus>(box, "PUT", "phone", change),
};

export interface PairedBox {
  name: string;
  url: string;
  token: string;
}

// pairingLink opens the first box's phone app and hands it every box, in
// the URL fragment so the tokens never reach a server or its logs.
export function pairingLink(boxes: PairedBox[]): string | undefined {
  if (!boxes.length) return undefined;
  const json = JSON.stringify(boxes.map((b) => ({ name: b.name, url: b.url, token: b.token })));
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${new URL(boxes[0].url).origin}/#pair=${b64}`;
}

// A topic only you know is what keeps ntfy notifications private.
export function newNtfyTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "https://ntfy.sh/berth-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
