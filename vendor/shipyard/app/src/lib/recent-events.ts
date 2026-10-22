import type { DiagEvent } from "@/lib/diagnostics-format";

// The last toasts the app showed, and among them the errors with their
// codes, for Copy diagnostics (lib/diagnostics). Kept in memory only.

const MAX = 20;
const toasts: DiagEvent[] = [];
const errors: DiagEvent[] = [];

const push = (list: DiagEvent[], e: DiagEvent) => {
  list.push(e);
  if (list.length > MAX) list.splice(0, list.length - MAX);
};

// noteToast records a toast as it is shown.
export function noteToast(t: { type?: string; title?: unknown; description?: unknown }, extra: { code?: string; message?: string } = {}) {
  const e: DiagEvent = {
    at: new Date().toISOString(),
    kind: t.type || "info",
    title: typeof t.title === "string" ? t.title : "",
    message: extra.message ?? (typeof t.description === "string" ? t.description : undefined),
    ...(extra.code ? { code: extra.code } : {}),
  };
  if (!e.title && !e.message) return;
  push(toasts, e);
  if (e.kind === "error") push(errors, e);
}

export const recentEvents = () => ({ errors: [...errors], toasts: [...toasts] });
