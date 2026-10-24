import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { useApplyTheme } from "@/hooks/use-theme";
import { CaptureBox, type CaptureHost } from "~/components/capture-box";
import { makeLinkHost } from "~/components/link-views";
import { setVisit } from "~/components/property-value";
import type { Draft } from "~/lib/capture";
import { loadSpace } from "~/lib/space";
import "./styles.css";

// The capture panel's page (capture.rs). A view only: drafts go to the main window, which
// saves and answers (lib/capture.ts, hostCapture), and so do the pages its link menu makes.
// "@" searches this window's own copy of the space, read from the store each time the box
// shows. An answer that never comes (the main window still loading) stops waiting after a
// while, so the box can still close.
let seq = 0;
const waiting = new Map<number, (id: string | null) => void>();
const answer = (e: { payload: { seq: number; id: string | null } }) => {
  waiting.get(e.payload.seq)?.(e.payload.id);
  waiting.delete(e.payload.seq);
};
void listen("ll:capture-saved", answer);
void listen("ll:capture-linked", answer);
const ask = (event: string, payload: object, fallback: string | null = null) =>
  new Promise<string | null>((resolve) => {
    const n = ++seq;
    waiting.set(n, resolve);
    setTimeout(() => waiting.get(n)?.(fallback), 5000);
    void emitTo("main", event, { seq: n, ...payload });
  });
const made = async (request: object) => {
  const id = (await ask("ll:capture-link", request)) ?? "";
  await loadSpace();
  return id;
};
const host: CaptureHost = {
  save: (draft: Draft) => ask("ll:capture", { draft }, draft.id),
  open: (id) => void invoke("capture_open", { id }),
  close: () => void invoke("capture_hide"),
  links: makeLinkHost({ create: (title, typeId) => made({ kind: "create", title, typeId }), day: (day) => made({ kind: "day", day }) }),
};
// A click on a link in the box opens the page in the main window.
setVisit((id) => void invoke("capture_open", { id }));

function Panel() {
  useApplyTheme();
  // Each time the panel is shown, a fresh idea and a fresh copy of the space.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    void loadSpace().catch(console.error);
    const off = listen("capture://show", () => {
      void loadSpace().catch(console.error);
      setShown((n) => n + 1);
    });
    return () => void off.then((f) => f());
  }, []);
  return <CaptureBox className="h-svh" host={host} key={shown} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
