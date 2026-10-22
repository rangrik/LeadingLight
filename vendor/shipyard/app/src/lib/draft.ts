import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { keyOf } from "@/lib/conversation-store";
import { type Draft, type DraftRead, mergeDraft } from "@/lib/draft-text";
import type { LiveStatus } from "@/lib/screen-status";
import { usePrefs } from "@/lib/prefs";
import { useStore } from "@/lib/store";

// The reply Claude Code is writing, read from its screen while the chat
// shows it (box: GET sessions/{name}/draft, boxes with "draft"), so the
// chat's answer grows as the terminal's does instead of landing whole when
// the transcript has it (lib/draft-text: how it grows and gives way).
//
// The box reads the screen rather than the app because it can read its
// styles (tmux capture-pane -e): what is the reply and what is Claude
// Code's own grey chrome, and its Markdown drawn as bold, colour and links.
//
// One read gives the draft and the status line ("Seasoning… · 12s"), so on
// such a box it replaces the status reader (lib/screen-status). Reads come
// every 600ms while a reply is being written and every 1.5s while the
// agent works on something else; never while the chat is hidden or the
// agent rests. A draft is kept a few seconds after the agent stops, for
// its transcript to catch up (the turn's end and its last words land at
// about the same time, in either order).

export interface DraftFeed {
  draft?: Draft;
  status?: LiveStatus;
  // The box reads drafts: the chat uses this rather than the plain screen.
  supported: boolean;
}

const DRAFTING = 600;
const WORKING = 1500;
const HOLD = 6000;

interface BoxDraft {
  agent?: string;
  text?: string;
  clipped?: boolean;
  status?: LiveStatus;
}

let seq = 0;
const nextId = () => `draft:${Date.now().toString(36)}-${++seq}`;

// The demo's drafts (lib/mock-conversation), by chat (keyOf): what its
// screen would show.
export const useMockDrafts = create<{ reads: Record<string, DraftRead | undefined> }>()(() => ({ reads: {} }));

export function useDraft({ box, session, agent, enabled, mock }: { box: string; session: string; agent?: string; enabled: boolean; mock: boolean }): DraftFeed {
  const client = useStore((s) => s.client);
  const capable = useStore((s) => !!s.boxes[box]?.info?.capabilities?.includes("draft"));
  // Turned off in Settings: replies land whole, and the pane reads the
  // agent's status line the older way (lib/screen-status).
  const on = usePrefs((p) => p.chatDrafts);
  const supported = on && (mock || (capable && agent === "claude"));
  const [draft, setDraft] = useState<Draft>();
  const [status, setStatus] = useState<LiveStatus>();
  const take = useRef((read: DraftRead | undefined) => setDraft((prev) => (read ? mergeDraft(prev, read, nextId) : undefined)));
  const key = keyOf(box, session);

  // Another chat starts with nothing.
  useEffect(() => {
    setDraft(undefined);
    setStatus(undefined);
  }, [key]);

  // The demo: its screen is a store.
  const mockRead = useMockDrafts((s) => (mock ? s.reads[key] : undefined));
  useEffect(() => {
    if (mock) take.current(on ? mockRead : undefined);
  }, [mock, mockRead, on]);

  useEffect(() => {
    if (mock || !supported || !client) return;
    if (!enabled) {
      // Kept a moment for the transcript to catch up, then let go.
      setStatus(undefined);
      const t = window.setTimeout(() => setDraft(undefined), HOLD);
      return () => window.clearTimeout(t);
    }
    let alive = true;
    let timer = 0;
    let writing = false;
    const read = async () => {
      if (!document.hidden) {
        try {
          const r = await client.box<BoxDraft>(box, "GET", `sessions/${encodeURIComponent(session)}/draft`);
          if (!alive) return;
          writing = !!r.text;
          take.current(r.text ? { text: r.text, clipped: r.clipped } : undefined);
          setStatus(r.status);
        } catch {
          // The pane says when the box is away; the draft waits for it.
        }
      }
      if (alive) timer = window.setTimeout(() => void read(), writing ? DRAFTING : WORKING);
    };
    void read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [mock, supported, client, enabled, box, session]);

  return { draft, status, supported };
}
