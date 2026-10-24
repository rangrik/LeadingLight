import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask } from "~/lib/project-runtime/transport";
import type { Session } from "~/lib/project-runtime/chat";
import { createStore } from "~/lib/state";
import { space } from "~/lib/space";
import { runOf } from "~/lib/work";

// Every agent's session as the runtime has it now, for the work shown on tasks and in the Feed,
// whichever pages are open. Read again when the runtime says an agent or a session changed.

export const sessions = createStore<Map<string, Session>>(new Map());

let started = false;
let timer = 0;
const read = () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const list = await ask<Session[]>("GET", "/v1/sessions").catch(() => null);
    if (list) sessions.set(new Map(list.map((s) => [s.name, s])));
  }, 250);
};

// Followed once any page has an agent at work.
export function watchWork() {
  if (started || !space.get().pages.some((p) => runOf(p))) return;
  started = true;
  read();
  onRuntimeEvent((e) => (e.type === "runtime.connected" || e.type.startsWith("agent.") || e.type.startsWith("session.") || e.type === "request.changed") && read());
}
