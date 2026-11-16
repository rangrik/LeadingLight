import { stampDoc } from "@leadinglight/editor/authorship";
import { CloudError, cloudState, onCloud } from "./cloud";
import { gmailApi, mailText, type MailAccount, type MailMessage, type MailPage, type MailSummary } from "./gmail";
import { commitAction, undoAction } from "./history";
import { action } from "./history-types";
import { type Account, compose, conversations, daysTo, order, fromPeople, isoDay, type Item, kindOf, LABEL, LOOK, type Kind, type Mail, mailKey, type MailState, type Outcome, parseState, type Read, type Said, say, sender, senderKey, type Snapshot } from "./mail-rules";
import { propOf, putProp } from "./space";
import { createStore } from "./state";
import { newObject } from "./store";
import { pageInit } from "./templates";

// Mail's data (docs/MAIL.md, section 4): what waits, the look, and the actions the
// screens call. All of it stays on this device, per workspace owner, like Calendar's hidden list.

export type Label = "INBOX" | "UNREAD";
export type ThreadPart = { from: string; date: number; text: string; files?: { name: string; size: number }[] };
// Where mail comes from: the service, or in a dev build with ?mail=demo the fixture (lib/mail-demo.ts).
export type Source = {
  demo: boolean;
  accounts(): Promise<MailAccount[]>;
  messages(account: string, after: number): Promise<MailSummary[]>;
  thread(account: string, threadId: string): Promise<ThreadPart[]>;
  counts(account: string): Promise<number>;
  modify(account: string, threadId: string, add: Label[], remove: Label[]): Promise<void>;
  send(account: string, id: string, text: string): Promise<void>;
  // How many mails this address has sent the account, counted to 2: 1 means this is its first.
  sent(account: string, address: string): Promise<number>;
  // Demo only: its first state, the reader's lines, and why the reader can't run.
  seed?(now: number): MailState;
  reads?(keys: string[], now: number): Record<string, Read>;
  cannot?: string;
};

const PAGES = 8;
const gmail: Source = {
  demo: false,
  accounts: async () => (await gmailApi<{ accounts: MailAccount[] }>("accounts")).accounts,
  async messages(account, after) {
    const all: MailSummary[] = [];
    let pageToken: string | null = null;
    for (let i = 0; i < PAGES; i++) {
      const page: MailPage = await gmailApi<MailPage>("messages", { account, after: Math.floor(after / 1000), ...(pageToken && { pageToken }) });
      all.push(...page.messages);
      if (!(pageToken = page.nextPageToken)) break;
    }
    return all;
  },
  thread: async (account, id) => (await gmailApi<{ messages: MailMessage[] }>("thread", { account, id })).messages.map((m) => ({ from: m.from, date: m.date, text: m.text || mailText(m.html), files: m.attachments ?? [] })),
  counts: async (account) => (await gmailApi<{ inbox: number }>("counts", { account })).inbox,
  modify: async (account, id, add, remove) => void (await gmailApi("modify", { account, id, add, remove })),
  send: async (account, id, text) => void (await gmailApi("send", { account, id, text })),
  sent: async (account, address) => (await gmailApi<MailPage>("messages", { account, query: `from:${address.replace(/[^\w.@+-]/g, "")}`, max: 2 })).messages.length,
};
const demoOn = import.meta.env.DEV && new URLSearchParams(location.search).get("mail") === "demo";
const source: Promise<Source> = demoOn ? import("./mail-demo").then((m) => m.demoSource()) : Promise.resolve(gmail);
export const mailSource = () => source;
const ownerNow = () => (demoOn ? "demo" : (cloudState().user?.id ?? null));

// The demo keeps its state in memory, so a reload starts it over.
const memory = new Map<string, string>();
const keyOf = (owner: string) => `leadinglight.mail:${owner}`;
async function load(owner: string): Promise<MailState> {
  if (demoOn && !memory.has(owner)) memory.set(owner, JSON.stringify((await source).seed!(Date.now())));
  if (demoOn) return parseState(memory.get(owner)!, Date.now());
  try {
    return parseState(localStorage.getItem(keyOf(owner)), Date.now());
  } catch {
    return parseState(null, Date.now());
  }
}
function save(owner: string, s: MailState) {
  if (demoOn) return void memory.set(owner, JSON.stringify(s));
  try {
    localStorage.setItem(keyOf(owner), JSON.stringify(s));
  } catch {
    // Private mode: Mail works for this session only.
  }
}

// later: kept today, back in the next look.
export type MailView = Snapshot & { owner: string | null; loading: boolean; error: string; said: Said; state: MailState; later: Item[] };
let owner: string | null = null;
let state: MailState = parseState(null, Date.now());
let accounts: Account[] = [];
let mails: Mail[] = [];
let status = { loading: false, error: "", reading: false, unread: "" };

function picture(): MailView {
  const now = Date.now(), today = isoDay(now);
  const people: Item[] = [], rest: Item[] = [], later: Item[] = [];
  const own = accounts.map((a) => a.email.toLowerCase());
  for (const m of mails) {
    const r = state.read[m.key], kept = state.kept[m.key], self = own.includes(m.address.toLowerCase());
    const item: Item = { mail: m, lines: r?.lines, group: self ? "Other" : r?.group, kept: !!kept, fresh: state.senders[senderKey(m)] === true };
    // Kept today means back in the next look, not this one.
    if (kept === today) later.push(item);
    else (!self && (fromPeople(m) || r?.lines || r?.needs || kept) ? people : rest).push(item);
  }
  const { look, waiting } = compose(people, state.today, now);
  later.sort((a, b) => (a.lines?.due ?? "9999-12-31").localeCompare(b.lines?.due ?? "9999-12-31") || a.mail.date - b.mail.date);
  const snap: Snapshot = { now, accounts, started: !!state.start, days: state.days, reading: status.reading, unread: status.unread, ran: state.ran, offline: typeof navigator !== "undefined" && !navigator.onLine, look, waiting, rest, later, today: state.today };
  return { ...snap, owner, loading: status.loading, error: status.error, said: say(snap), state, later };
}
export const mail = createStore<MailView>(picture());
export const useMail = mail.use;
const publish = () => mail.set(picture());

async function change(edit: (s: MailState) => void) {
  if (!owner) throw new Error("Sign in to LeadingLight to use Mail.");
  const who = owner;
  const s = await load(who);
  edit(s);
  if (owner !== who) return;
  save(who, (state = s));
  publish();
}

// A workspace's mail never shows in another: switching drops it, and late answers are ignored.
let generation = 0, refreshing = 0;
// A full listing of the window when the app opens, after Start fresh and every 30 minutes; in
// between, only mail since the last listing, merged by key.
const FULL = 30 * 60_000, MARGIN = 15 * 60_000;
let listed = { any: 0, full: 0 };
function reset(next: string | null) {
  generation++;
  listed = { any: 0, full: 0 };
  owner = next;
  accounts = [];
  mails = [];
  state = parseState(null, Date.now());
  status = { loading: false, error: "", reading: false, unread: "" };
  publish();
}
// The reader lists the new workspace's mail first, then reads it.
onCloud(() => {
  if (!demoOn && ownerNow() !== owner) {
    reset(ownerNow());
    void import("./mail-reader").then((r) => r.runReader({ force: true }));
  }
});
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void refresh());
  window.addEventListener("offline", publish);
}

const toMail = (s: MailSummary, a: MailAccount, kind: Kind): Mail => ({ ...s, replyTo: s.replyTo ?? "", ...sender(s.from || "Unknown sender"), key: mailKey(a.account, s.id), account: a.account, email: a.email, kind });
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Lists each account's inbox since the start-fresh day (or, before it, how much is waiting).
export async function refresh(o: { full?: boolean } = {}) {
  const who = ownerNow();
  if (who !== owner) reset(who);
  if (!who) return;
  const run = generation, request = ++refreshing, src = await source;
  status.loading = true;
  publish();
  try {
    const s = await load(who), list = await src.accounts(), at = Date.now();
    const full = !!o.full || !listed.full || at - listed.full > FULL;
    const after = full ? s.start : Math.max(s.start, listed.any - MARGIN);
    const found: Mail[] = [];
    let whole = full;
    const next = await Promise.all(list.map(async (a): Promise<Account> => {
      const kind = kindOf(a.email, s.kinds[a.email]);
      try {
        if (!s.start) return { ...a, kind, out: false, inbox: await src.counts(a.account) };
        const got = await src.messages(a.account, after);
        if (got.length >= PAGES * 25) whole = false;
        found.push(...got.map((m) => toMail(m, a, kind)));
        return { ...a, kind, out: false };
      } catch (e) {
        if (e instanceof CloudError && e.status === 401) return { ...a, kind, out: true };
        throw e;
      }
    }));
    if (run !== generation || request !== refreshing) return;
    // Lines and keeps for mail gone from a live inbox go too: it was dealt with, here or in Gmail.
    const live = new Set(next.filter((a) => !a.out).map((a) => a.account)), present = new Set(found.map((m) => m.key));
    const gone = (k: string) => whole && live.has(JSON.parse(k)[0]) && !present.has(k);
    for (const k of Object.keys(s.read)) if (gone(k)) delete s.read[k];
    for (const k of Object.keys(s.kept)) if (gone(k)) delete s.kept[k];
    save(who, (state = s));
    accounts = next;
    const merged = new Map((full ? [] : mails).map((m) => [m.key, m]));
    for (const m of found) merged.set(m.key, m);
    mails = conversations([...merged.values()].filter((m) => live.has(m.account))).sort((a, b) => a.date - b.date);
    if (s.start) listed = { any: at, full: full ? at : listed.full };
    status.error = "";
  } catch (e) {
    if (run === generation && request === refreshing) status.error = why(e);
  } finally {
    if (run === generation && request === refreshing) {
      status.loading = false;
      publish();
    }
  }
}

// Called by the reader (lib/mail-reader.ts).
export const readerInput = () => ({ owner, mails, state, own: accounts.map((a) => a.email.toLowerCase()) });
export function setReader(patch: Partial<Pick<typeof status, "reading" | "unread">>) {
  Object.assign(status, patch);
  publish();
}
export async function saveReads(who: string, reads: Record<string, Read>, ran?: number) {
  if (who !== owner) return;
  await change((s) => {
    for (const [k, r] of Object.entries(reads)) s.read[k] = { ...s.read[k], ...r };
    if (ran) s.ran = ran;
  });
}
export async function saveSenders(who: string, found: Record<string, boolean>) {
  if (who === owner && Object.keys(found).length) await change((s) => void Object.assign(s.senders, found));
}

export async function startFresh(days: 3 | 7 | 14) {
  await change((s) => {
    s.start = Date.now() - days * 86_400_000;
    s.days = days;
  });
  await refresh({ full: true });
  void import("./mail-reader").then((r) => r.runReader({ force: true }));
}
export async function setKind(email: string, kind: Kind) {
  await change((s) => void (s.kinds[email] = kind));
  accounts = accounts.map((a) => (a.email === email ? { ...a, kind } : a));
  mails = mails.map((m) => (m.email === email ? { ...m, kind } : m));
  publish();
}

// The look: fixed when he starts, five more on Keep going, closed for the day at the end.
export const startLook = () =>
  change((s) => {
    if (!s.today.set.length) s.today.set = mail.get().look.map((i) => i.mail.key);
    s.today.started ||= Date.now();
  });
// Mail kept for later today that is due today comes back on its own; else five more.
export const keepGoing = () =>
  change((s) => {
    const v = mail.get(), back = v.later.filter((i) => i.lines?.due && daysTo(i.lines.due, Date.now()) === 0).map((i) => i.mail.key);
    for (const k of back) {
      delete s.today.handled[k];
      delete s.kept[k];
    }
    s.today.set = [...new Set([...s.today.set, ...(back.length ? back : order(v.waiting.slice(0, LOOK), Date.now()).map((i) => i.mail.key))])];
    Object.assign(s.today, { closed: false, left: 0 });
  });
// Undo after the end opens the look again.
export const reopenLook = () => change((s) => void (s.today.closed = false));
export const endLook = () => change((s) => void Object.assign(s.today, { closed: true, ended: Date.now(), left: mail.get().waiting.length }));

// The one line each failure shows under the mail (design 5.3).
export type Trouble = "send" | "move" | "gone";
const TROUBLE: Record<Trouble, string> = { send: "Didn't send. Your reply is kept.", move: "Couldn't put this away in Gmail.", gone: "This mail is no longer in Gmail." };
export class MailError extends Error {
  constructor(readonly trouble: Trouble) {
    super(TROUBLE[trouble]);
  }
}
const failed = (e: unknown, trouble: Trouble) => new MailError(e instanceof CloudError && e.status === 404 ? "gone" : trouble);
// undo is false when it came too late (a reply already sent). settled is Gmail's side.
export type Undo = () => Promise<boolean>;
export type Done = { undo: Undo; settled: Promise<void> };

async function move(i: Item, add: Label[], remove: Label[]) {
  try {
    await (await source).modify(i.mail.account, i.mail.threadId, add, remove);
  } catch (e) {
    throw failed(e, "move");
  }
}
// Archive and mark read; the error's Try again calls it again.
export const putAway = (i: Item) => move(i, [], ["INBOX", "UNREAD"]);
const putBack = (i: Item) => move(i, ["INBOX", ...(i.mail.unread ? (["UNREAD"] as const) : [])], []);

// A decision is logged for today; dealing with a mail deletes its lines (undo puts them back).
type Before = { read?: Read; kept?: string };
// due: a task's date, so the end can name the next one.
async function decide(i: Item, outcome: Outcome, due?: string): Promise<Before> {
  const k = i.mail.key, before = { read: state.read[k], kept: state.kept[k] };
  await change((s) => {
    s.today.handled[k] = outcome;
    if (due) s.today.dues[k] = due;
    s.today.started ||= Date.now();
    if (outcome === "later") s.kept[k] = isoDay(Date.now());
    else {
      delete s.read[k];
      delete s.kept[k];
    }
  });
  return before;
}
const undecide = (i: Item, b: Before) =>
  change((s) => {
    const k = i.mail.key;
    delete s.today.handled[k];
    delete s.today.dues[k];
    if (b.read) s.read[k] = b.read;
    if (b.kept) s.kept[k] = b.kept;
    else delete s.kept[k];
  });

// A send waits 8 seconds for Undo; leaving the app sends at once.
const HOLD = 8000;
const held = new Map<string, () => void>();
function hold(key: string, go: () => Promise<void>) {
  let settle!: (p?: Promise<void>) => void;
  const settled = new Promise<void>((resolve) => (settle = resolve as typeof settle));
  const run = () => {
    clearTimeout(timer);
    held.delete(key);
    settle(go());
  };
  const timer = setTimeout(run, HOLD);
  held.set(key, run);
  return { settled, cancel: () => (held.delete(key) ? (clearTimeout(timer), settle(), true) : false) };
}
export const sendHeldNow = () => [...held.values()].forEach((run) => run());
if (typeof window !== "undefined") window.addEventListener("pagehide", sendHeldNow);

// A reply that failed to send, kept for the box.
const unsent = new Map<string, string>();
export const keptReply = (key: string) => unsent.get(key);
// Try again on a task's "Also reply" that did not send: the task is made, so only the reply and the put-away run.
export const sendAgain = async (i: Item, text: string) => (await send(i, text), await putAway(i));
async function send(i: Item, text: string) {
  try {
    await (await source).send(i.mail.account, i.mail.id, text);
    unsent.delete(i.mail.key);
  } catch (e) {
    unsent.set(i.mail.key, text);
    throw failed(e, "send");
  }
}

// On screen at once; Gmail's side runs behind and, if it fails, the mail comes back.
export async function done(i: Item): Promise<Done> {
  const b = await decide(i, "done");
  const settled = putAway(i).catch(async (e) => {
    await undecide(i, b);
    throw e;
  });
  return { settled, undo: async () => (await settled.then(async () => (await putBack(i), await undecide(i, b)), () => {}), true) };
}
export async function later(i: Item): Promise<Done> {
  const b = await decide(i, "later");
  return { settled: Promise.resolve(), undo: async () => (await undecide(i, b), true) };
}
// Keep one of the rest: it stays in Gmail and is a mail in the next look.
export async function keep(i: Item): Promise<Done> {
  await change((s) => void (s.kept[i.mail.key] = isoDay(Date.now())));
  return { settled: Promise.resolve(), undo: async () => (await change((s) => void delete s.kept[i.mail.key]), true) };
}
export class ClearError extends Error {
  constructor(readonly count: number) {
    super(`${count} could not be put away in Gmail. ${count === 1 ? "It is" : "They are"} back in the rest.`);
  }
}
// Gone from view at once; those Gmail would not put away come back to the rest.
export async function clearRest(items: Item[] = mail.get().rest): Promise<Done & { cleared: number }> {
  const run = generation, keys = new Set(items.map((i) => i.mail.key));
  const reads = Object.fromEntries(items.map((i) => [i.mail.key, state.read[i.mail.key]]));
  await change((s) => {
    s.today.cleared += items.length;
    s.today.started ||= Date.now();
    for (const k of keys) delete s.read[k];
  });
  mails = mails.filter((m) => !keys.has(m.key));
  publish();
  const back = async (list: Item[]) => {
    if (run !== generation || !list.length) return;
    await change((s) => {
      s.today.cleared -= list.length;
      for (const i of list) if (reads[i.mail.key]) s.read[i.mail.key] = reads[i.mail.key];
    });
    mails = [...mails, ...list.map((i) => i.mail)].sort((a, b) => a.date - b.date);
    publish();
  };
  const failed: Item[] = [];
  const settled = (async () => {
    for (let n = 0; n < items.length; n += 5) await Promise.all(items.slice(n, n + 5).map((i) => putAway(i).catch(() => void failed.push(i))));
    if (!failed.length) return;
    await back(failed);
    throw new ClearError(failed.length);
  })();
  return {
    cleared: items.length,
    settled,
    undo: async () => {
      await settled.catch(() => {});
      const ok = items.filter((i) => !failed.includes(i));
      for (const i of ok) await putBack(i);
      await back(ok);
      return true;
    },
  };
}

export function reply(i: Item, text: string): Promise<Done> {
  const body = text.trim();
  if (!body) return Promise.reject(new Error("Write a reply first."));
  if (accounts.some((a) => a.email.toLowerCase() === i.mail.address.toLowerCase())) return Promise.reject(new Error("This mail is from you."));
  return decide(i, "replied").then((b) => {
    const h = hold(i.mail.key, async () => {
      try {
        await send(i, body);
      } catch (e) {
        await undecide(i, b);
        throw e;
      }
      await putAway(i);
    });
    return { settled: h.settled, undo: async () => h.cancel() && (await undecide(i, b), true) };
  });
}

// A Task page: title, due, From mail and the reader's first two lines. Never the mail's own text.
export const FROM_MAIL = "from-mail";
export type MailRef = { account: string; email: string; id: string; threadId: string };
export const gmailLink = (r: MailRef) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(r.email)}#all/${encodeURIComponent(r.threadId)}`;
export async function makeTask(i: Item, o: { title: string; due?: string; reply?: string }): Promise<Done & { id: string }> {
  const title = o.title.trim();
  if (!title) throw new Error("Give the task a title.");
  if (!propOf(FROM_MAIL)) await putProp({ id: FROM_MAIL, name: "From mail", kind: "text", options: {}, createdAt: Date.now() });
  const m = i.mail, context = action("Made task from mail");
  const lines = i.lines ? [i.lines.happened, i.lines.stands] : [];
  const ref: MailRef = { account: m.account, email: m.email, id: m.id, threadId: m.threadId };
  const content = stampDoc({ type: "doc", content: lines.length ? lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) : [{ type: "paragraph" }] }, context.author);
  const task = newObject(await pageInit("task", { title, content, properties: { ...(o.due && { due: { start: o.due } }), [FROM_MAIL]: `${m.name} · ${LABEL[m.kind]} · ${m.subject}`, mail: ref } }));
  await commitAction([{ before: null, after: task }], context);
  const b = await decide(i, "task", o.due);
  const ack = o.reply?.trim();
  let moved = false;
  const away = async () => {
    await putAway(i);
    moved = true;
  };
  const h = ack ? hold(m.key, async () => (await send(i, ack), await away())) : null;
  return {
    id: task.id,
    settled: h ? h.settled : away(),
    undo: async () => {
      h?.cancel();
      await undoAction(context.action);
      if (moved) await putBack(i);
      await undecide(i, b);
      return true;
    },
  };
}
