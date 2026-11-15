import { useEffect } from "react";
import { tailPrefs } from "./ai-prefs";
import { cloudState } from "./cloud";
import { mailSource, readerInput, refresh, saveReads, saveSenders, setReader, type Source, type ThreadPart } from "./mail";
import { READER, readAnswer, readerMessage } from "./mail-read";
import { fromPeople, isoDay, type Mail, type MailState, type Read, senderKey } from "./mail-rules";
import { isNative } from "./platform";
import { tailTurn } from "./turn";

// The reader (docs/MAIL.md, section 4): one fixed request through the same path as a
// tail turn (lib/turn.ts tailTurn, src-tauri/src/agent.rs with tail set), so the model has no
// tools and no notes. It reads only mail that came since it last ran, and its lines stay here.

const EVERY = 30 * 60_000;
const AGAIN = 2 * 60_000;
// Mail can show up in Gmail a little after it was sent.
const MARGIN = 15 * 60_000;
// More than 4 conversations in one request can run past the 120 s limit.
const PEOPLE = 4;
const REST = 60;
let running: Promise<void> | null = null;
let finished = 0;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Why it could not read, as the end of "LeadingLight could not read these for you."
const reason = (e: unknown) => {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");
  return m === "not signed in" ? "Sign in to Claude Code or Codex on this Mac." : `${cap(m)}.`;
};

async function ask(people: { mail: Mail; thread: ThreadPart[] }[], rest: Mail[]) {
  const { message, ids } = readerMessage({ now: Date.now(), name: cloudState().user?.name?.split(" ")[0] ?? "", people, rest });
  const got = await tailTurn({ prompt: message, system: READER, model: tailPrefs().model, effort: "medium" });
  if (got.error) throw new Error(got.error);
  const reads = readAnswer(got.text, ids, Date.now());
  if (!reads) throw new Error("The model's answer could not be read");
  return reads;
}

// Whether each new address in mail from people has written before: one search each, kept.
async function senders(owner: string, src: Source, mails: Mail[], state: MailState, own: string[]) {
  const found: Record<string, boolean> = {};
  for (const m of mails.filter((m) => fromPeople(m, own) && !(senderKey(m) in state.senders)).slice(0, 10)) {
    if (senderKey(m) in found) continue;
    try {
      found[senderKey(m)] = (await src.sent(m.account, m.address)) === 1;
    } catch {
      // Unknown until the next run; no tag meanwhile.
    }
  }
  await saveSenders(owner, found);
}

async function read() {
  await refresh();
  const { owner, mails, state, own } = readerInput();
  if (!owner || !state.start) return;
  const src = await mailSource(), started = Date.now(), today = isoDay(started);
  await senders(owner, src, mails, state, own);
  const since = state.ran ? state.ran - MARGIN : 0;
  // A date that passed after its lines were written is read once more, to say what it means now.
  const passed = (m: Mail) => { const r = state.read[m.key], due = r?.lines?.due; return !!due && due < today && isoDay(r.at) <= due; };
  const todo = mails.filter((m) => (!state.read[m.key] && m.date >= since) || (!src.demo && passed(m)));
  if (src.demo) {
    if (src.cannot) return setReader({ unread: src.cannot });
    setReader({ reading: true });
    await new Promise((r) => setTimeout(r, 600));
    await saveReads(owner, src.reads!(todo.map((m) => m.key), started), started);
    return setReader({ reading: false, unread: "" });
  }
  if (!(await isNative)) return setReader({ unread: todo.length ? "Reading needs the Mac app." : "" });
  setReader({ reading: !!todo.length });
  try {
    const reads: Record<string, Read> = {};
    // The rest first: a skim can find one that does need him, which is then read in full.
    const rest = todo.filter((m) => !fromPeople(m, own));
    for (let i = 0; i < rest.length; i += REST) Object.assign(reads, await ask([], rest.slice(i, i + REST)));
    // Kept at once, so a later failure does not lose the skim.
    if (rest.length) await saveReads(owner, reads);
    const people = [...todo.filter((m) => fromPeople(m, own)), ...rest.filter((m) => reads[m.key]?.needs && !own.includes(m.address.toLowerCase()))];
    for (let i = 0; i < people.length; i += PEOPLE) {
      const batch = people.slice(i, i + PEOPLE);
      const threads = await Promise.all(batch.map((m) => src.thread(m.account, m.threadId).catch(() => [])));
      for (const [k, r] of Object.entries(await ask(batch.map((mail, j) => ({ mail, thread: threads[j] })), []))) reads[k] = { ...reads[k], ...r };
      await saveReads(owner, reads);
    }
    await saveReads(owner, reads, started);
    setReader({ unread: "" });
  } catch (e) {
    setReader({ unread: reason(e) });
  } finally {
    setReader({ reading: false });
  }
}

// Runs once at a time; without force, not again within two minutes of the last run.
export function runReader(o: { force?: boolean } = {}): Promise<void> {
  if (!running && !o.force && Date.now() - finished < AGAIN) return Promise.resolve();
  return (running ??= read()
    .catch(console.error)
    .finally(() => {
      running = null;
      finished = Date.now();
    }));
}

// Mounted once by the app: when it opens, when it comes to the front, and every 30 minutes.
// Today opening calls runReader() itself.
export function useMailReader() {
  useEffect(() => {
    void runReader({ force: true });
    const front = () => document.visibilityState === "visible" && void runReader();
    const timer = setInterval(() => void runReader({ force: true }), EVERY);
    window.addEventListener("focus", front);
    document.addEventListener("visibilitychange", front);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", front);
      document.removeEventListener("visibilitychange", front);
    };
  }, []);
}
