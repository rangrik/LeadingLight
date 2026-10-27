import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { useApplyTheme } from "@/hooks/use-theme";
import { type Prefs, usePrefs } from "@/lib/prefs";
import { load } from "@/lib/storage";
import { useStore } from "@/lib/store";
import { CaptureBox, type CaptureHost } from "~/components/capture-box";
import { makeLinkHost } from "~/components/link-views";
import { setVisit } from "~/components/property-value";
import type { Draft, Guess } from "~/lib/capture";
import { loadSpace } from "~/lib/space";
import "./styles.css";

// The capture panel's page (capture.rs). A view only: drafts go to the main window, which
// saves and answers (lib/capture.ts, hostCapture), and so do the pages its link menu and
// project picker make.
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
const create = (title: string, typeId: string) => made({ kind: "create", title, typeId });
// Tail's guess is a model turn in the main window, so it has no time limit; the box drops one
// about older words.
const guesses = new Map<number, (guess: Guess) => void>();
void listen<Guess & { seq: number }>("ll:capture-guessed", ({ payload: { seq: n, ...guess } }) => {
  guesses.get(n)?.(guess);
  guesses.delete(n);
});
const host: CaptureHost = {
  save: (draft: Draft) => ask("ll:capture", { draft }, draft.id),
  open: (id) => void invoke("capture_open", { id }),
  close: () => void invoke("capture_hide"),
  links: makeLinkHost({ create, day: (day) => made({ kind: "day", day }) }),
  create,
  guess: (text, opened) =>
    new Promise((resolve) => {
      const n = ++seq;
      guesses.set(n, resolve);
      void emitTo("main", "ll:capture-guess", { seq: n, text, opened });
    }),
};
// A click on a link in the box opens the page in the main window.
setVisit((id) => void invoke("capture_open", { id }));
// Shipyard reads the theme once, when this page loads at app start, so a theme picked later in
// the main window is read again on a storage event and each time the box shows. The whole of
// each value is taken, so the save it sets off here writes back the same thing.
const readTheme = () => {
  useStore.setState(load<{ themeId?: string }>("berth.ui", {}));
  usePrefs.setState(load<Partial<Prefs>>("berth.prefs", {}));
};
addEventListener("storage", (e) => (e.key === "berth.ui" || e.key === "berth.prefs") && readTheme());

function Panel() {
  useApplyTheme();
  // Each time the panel is shown, a fresh idea and a fresh copy of the space.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    void loadSpace().catch(console.error);
    const off = listen("capture://show", () => {
      readTheme();
      void loadSpace().catch(console.error);
      setShown((n) => n + 1);
    });
    return () => void off.then((f) => f());
  }, []);
  // The window is the box plus room for its shadow (capture.rs turns macOS's off). A click in
  // that room keeps the keyboard where it was.
  return (
    <div className="h-svh px-6 pt-1 pb-11" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <CaptureBox className="h-full shadow-xl" host={host} key={shown} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
