import { useEffect, useRef, useState } from "react";
import type { Call, RuntimeRequest } from "./requests";

export type ApprovalFeedback = { id: string; request: string; command: string; session: string; text: string; attempted?: boolean };
const read = (key: string): ApprovalFeedback | null => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && [value.id, value.request, value.command, value.session, value.text].every((x) => typeof x === "string" && x.length) ? value : null;
  } catch { return null; }
};

// Codex accepts feedback as a new message, after our decline is recorded.
export function useApprovalFeedback(chatKey: string, requests: RuntimeRequest[]) {
  const key = `${chatKey}:approval-feedback`;
  const [stored, setStored] = useState(() => ({ key, value: read(key) }));
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const currentKey = useRef(key);
  currentKey.current = key;
  const value = stored.key === key ? stored.value : read(key);
  useEffect(() => { setStored({ key, value: read(key) }); }, [key]);
  const keep = (next: ApprovalFeedback | null) => {
    if (next) localStorage.setItem(key, JSON.stringify(next));
    else localStorage.removeItem(key);
    if (currentKey.current === key) setStored({ key, value: next });
  };
  const request = value && requests.find((r) => r.id === value.request);
  const confirmed = !!(value && request?.command === value.command && ["recorded", "resolved"].includes(request.state));
  return {
    value, confirmed, sending,
    save(request: string, command: string, session: string, text: string, options?: { replaceRefused: boolean }) {
      const replace = options?.replaceRefused && !value?.attempted;
      if (value && (value.request !== request || value.session !== session || value.command !== command && !replace)) throw new Error("Send or dismiss the saved feedback first.");
      if (!value || replace) keep(text.trim() ? { id: value?.id ?? crypto.randomUUID(), request, command, session, text: text.trim() } : null);
    },
    dismiss() { if (!inFlight.current) keep(null); },
    async send(call: Call) {
      if (!value || !confirmed || inFlight.current) return;
      inFlight.current = true;
      setSending(true);
      keep({ ...value, attempted: true });
      try {
        const result = await call("POST", `/v1/sessions/${encodeURIComponent(value.session)}/send`, { text: `Feedback on the declined request:\n${value.text}`, when: "now", idem_key: value.id });
        if (result.status !== 200) throw new Error((result.body as { error?: string })?.error ?? "The Mac has not confirmed this feedback. Retry when connected.");
        if (read(key)?.id === value.id) keep(null);
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
  };
}
