import { useEffect, useState } from "react";

import { boxApi } from "@/lib/api";
import { useStore } from "@/lib/store";

// What a working agent's own screen says that its record doesn't yet: its
// status line ("✻ Seasoning… (9m 11s · ↓ 7.1k tokens)") and the words it
// printed before the step it is running, which Claude Code writes to its
// transcript only later. Read while the chat is showing and the agent
// works, every few seconds, never faster.

export interface LiveStatus {
  // The agent's word for what it does: "Seasoning…", "Working".
  word: string;
  // As the agent counts it: "9m 11s".
  elapsed?: string;
  // "7.1k tokens".
  tokens?: string;
}

export interface ScreenStatus {
  status?: LiveStatus;
  // The agent's latest words above its running step, as one paragraph.
  said?: string;
}

const EVERY = 2500;

export function useScreenStatus(box: string, session: string, agent: string | undefined, enabled: boolean): ScreenStatus | undefined {
  const client = useStore((s) => s.client);
  const [live, setLive] = useState<ScreenStatus>();
  useEffect(() => {
    if (!client || !enabled || (agent !== "claude" && agent !== "codex")) {
      setLive(undefined);
      return;
    }
    let alive = true;
    let busy = false;
    const read = () => {
      if (busy || document.hidden) return;
      busy = true;
      boxApi
        .screen(client, box, session)
        .then((r) => alive && setLive(parseScreen(r.screen ?? "", agent)))
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    read();
    const t = window.setInterval(read, EVERY);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [client, box, session, agent, enabled]);
  return live;
}

// Claude Code: "✻ Seasoning… (9m 11s · ↓ 7.1k tokens · esc to interrupt)".
const CLAUDE_STATUS = /^\s*[✻✽✶✳✢·*✦]\s+([A-Z][\w' -]{0,40}?…)\s*\(([^)]*)\)/;
// Codex: "• Working (12s • esc to interrupt)".
const CODEX_STATUS = /^\s*[•◦]\s+([A-Z][\w' -]{0,40}?)\s*\((\d[^)]*)\)/;
// A tool call's line, not words: "⏺ Bash(yarn test)", "⏺ Update(src/a.ts)".
const TOOL_LINE = /^[A-Z][A-Za-z]*\(/;
// Claude Code's own notes in the same place.
const NOT_WORDS = /^(Background command|Interrupted|API Error|No response requested)/;

export function parseScreen(screen: string, agent: string): ScreenStatus {
  const lines = screen.split("\n");
  const out: ScreenStatus = {};
  let statusAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = (agent === "codex" ? CODEX_STATUS : CLAUDE_STATUS).exec(lines[i]);
    if (m) {
      const rest = m[2];
      out.status = {
        word: m[1].trim(),
        elapsed: /(?:\d+h\s*)?(?:\d+m\s*)?\d+s/.exec(rest)?.[0],
        tokens: /([\d.]+k?)\s*tokens/.exec(rest)?.[0],
      };
      statusAt = i;
      break;
    }
  }
  if (agent !== "claude") return out;
  // Words are above the status line, or with none, above the input box.
  let end = statusAt;
  if (end === lines.length)
    for (let i = lines.length - 1; i >= 0; i--)
      if (/^\s*─{8,}/.test(lines[i]) && /^\s*❯/.test(lines[i + 1] ?? "")) {
        end = i;
        break;
      }
  // The last paragraph of words: "⏺ text" (● on Linux) and the lines
  // indented under it. A paragraph with "⎿" under it is a tool call's
  // header ("⏺ Waiting 20 seconds", "⏺ Bash(yarn test)"), not words.
  for (let i = end - 1; i >= 0; i--) {
    // At the margin: the footer's "● high · /effort" is indented.
    const m = /^[⏺●]\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const words = [m[1].trim()];
    let j = i + 1;
    for (; j < end; j++) {
      const l = lines[j];
      if (!/^\s{2,}\S/.test(l) || /^\s*⎿/.test(l)) break;
      words.push(l.trim());
    }
    if (/^\s*⎿/.test(lines[j] ?? "") || TOOL_LINE.test(words[0]) || NOT_WORDS.test(words[0])) continue;
    const said = words.join(" ").replace(/\s+/g, " ").trim();
    if (said) out.said = said.slice(0, 600);
    break;
  }
  return out;
}

// The same words, as the transcript and the screen each wrap and mark
// them: compared without Markdown, spacing or case.
export const plainWords = (s: string) =>
  s
    .replace(/[`*_#>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// A short, calm word for working when the agent's own isn't readable.
export const HARBOUR_WORDS = ["Charting", "Sounding", "Rigging", "Trimming the sails", "Reading the tide", "Making way"];
