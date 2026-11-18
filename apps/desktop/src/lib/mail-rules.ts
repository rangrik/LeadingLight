// Mail's rules that need no model (docs/MAIL.md, sections 4 and 5): the sort, the
// minutes, the look and the words for Today and Mail home. No app imports, so node --test loads it.

export type Kind = "personal" | "work";
export type Verdict = "none" | "quick" | "reply" | "work";
export type Group = "Receipts" | "Newsletters" | "Notifications" | "Other";
export type Draft = { label: string; text: string };
// What the reader wrote about one mail from people. due is an ISO day.
export type Lines = {
  verdict: Verdict;
  headline: string;
  happened: string;
  stands: string;
  part: string;
  due?: string;
  upset: boolean;
  tone?: string;
  worry?: string;
  replies: Draft[];
  task?: { title: string; due?: string; ack: string };
};
// One inbox mail, as the service lists it, with the account it came to.
export type Mail = {
  key: string;
  account: string;
  email: string;
  kind: Kind;
  id: string;
  threadId: string;
  from: string;
  name: string;
  address: string;
  subject: string;
  to: string;
  cc: string;
  replyTo: string;
  snippet: string;
  date: number;
  unread: boolean;
  labels: string[];
  unsubscribe: boolean;
};
// fresh: the first mail ever from this address in the account.
export type Item = { mail: Mail; lines?: Lines; group?: Group; kept: boolean; fresh?: boolean };
export type Outcome = "done" | "replied" | "task" | "later";
// What today's look did. set is fixed when he starts; left is what waited when it closed; dues are tasks' dates.
export type Day = { day: string; set: string[]; handled: Record<string, Outcome>; dues: Record<string, string>; cleared: number; clearedKeys?: Record<string, true>; started: number; ended: number; closed: boolean; left: number };
export type Read = { at: number; lines?: Lines; group?: Group; needs?: boolean };
// senders: whether an address (senderKey) is new to the account, found once and kept.
export type MailState = { start: number; days: number; ran: number; kinds: Record<string, Kind>; kept: Record<string, string>; read: Record<string, Read>; senders: Record<string, boolean>; today: Day };

export const LOOK = 5;
export const KEEP_LINES = 14 * 86_400_000;
export const LABEL: Record<Kind, string> = { personal: "Personal", work: "Work" };
export const VERDICT: Record<Verdict, string> = { none: "Nothing to do", quick: "Quick answer", reply: "Needs a reply", work: "Needs work" };
const MINUTES: Record<Verdict, number> = { none: 0, quick: 1, reply: 3, work: 1 };
const CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

export const mailKey = (account: string, id: string) => JSON.stringify([account, id]);
export const senderKey = (m: Pick<Mail, "account" | "address">) => `${m.account}\n${m.address.toLowerCase()}`;
export const kindOf = (email: string, saved?: Kind): Kind => saved || (/@(gmail|googlemail)\.com$/i.test(email) ? "personal" : "work");
export function sender(from: string) {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return { name: from.trim(), address: from.trim() };
  const name = match[1].replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
  return { name: name || match[2], address: match[2] };
}
// The addresses in a To, Cc or Reply-To header, without names.
export const addresses = (header: string) => (header.match(/(?:[^,"]|"[^"]*")+/g) ?? []).map((p) => sender(p).address).filter((a) => a.includes("@"));
// Where a reply goes: Reply-To when the mail has one, as the service does.
export const replyAddress = (m: Pick<Mail, "replyTo" | "address">) => addresses(m.replyTo ?? "").join(", ") || m.address;
export const noReply = (address: string) => /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply)(?:[-_.+@]|$)/i.test(address);
// own: his connected addresses. Mail he sent himself is never from people, so no reply goes to him.
export const fromPeople = (m: Pick<Mail, "labels" | "unsubscribe" | "address">, own: string[] = []) =>
  !m.unsubscribe && !m.labels.some((l) => CATEGORIES.includes(l)) && !noReply(m.address) && !own.includes(m.address.toLowerCase());
// One item per conversation: its newest mail, unread if any of them is.
export function conversations(mails: Mail[]) {
  const newest = new Map<string, Mail>();
  for (const m of mails) {
    const k = `${m.account}\n${m.threadId}`, had = newest.get(k);
    const unread = m.unread || !!had?.unread;
    newest.set(k, { ...(had && had.date > m.date ? had : m), unread });
  }
  return [...newest.values()];
}
// Without the reader, Gmail's own filing names the group.
export const ruleGroup = (m: Pick<Mail, "labels" | "unsubscribe">): Group =>
  m.labels.includes("CATEGORY_UPDATES") ? "Notifications" : m.unsubscribe || m.labels.includes("CATEGORY_PROMOTIONS") ? "Newsletters" : "Other";

export const isoDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const clock = (t: number) => {
  const d = new Date(t);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
const dateOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const shortDay = (iso: string) => {
  const at = dateOf(iso);
  return `${DAYS[at.getDay()]}, ${MONTHS[at.getMonth()]} ${at.getDate()}`;
};
// Whole days from today; rounding absorbs a daylight-saving hour.
export const daysTo = (iso: string, now: number) => Math.round((dateOf(iso).getTime() - midnight(now)) / DAY);
// When a mail came: the time today, the weekday this week, else the date.
export function ago(t: number, now: number) {
  const n = Math.round((midnight(now) - midnight(t)) / DAY), at = new Date(t);
  return !n ? clock(t) : n < 7 ? DAYS[at.getDay()] : `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

// The date tag (design 5.0). soon is amber, quiet is muted; day and days are set for a later date.
export type When = { text: string; tone: "soon" | "plain" | "quiet"; day?: string; days?: number };
export function when(l: Lines | undefined, now: number): When | undefined {
  if (!l) return;
  if (!l.due) return l.verdict === "none" ? undefined : { text: "No deadline", tone: "quiet" };
  const n = daysTo(l.due, now), day = shortDay(l.due);
  if (n < 0) return { text: `Was ${day}`, tone: l.verdict === "none" ? "quiet" : "soon" };
  if (n < 2) return { text: n ? "Tomorrow" : "Today", tone: "soon" };
  return { text: `By ${day} · ${n} days left`, tone: "plain", day, days: n };
}

// Not read: he reads it himself, which costs what a reply does.
export const minutesOf = (i: Item) => (i.lines ? MINUTES[i.lines.verdict] : 3);
export const minutes = (items: Item[]) => Math.max(1, Math.ceil(items.reduce((n, i) => n + minutesOf(i), 0)));

// Due today or tomorrow first (kept mail too), then lightest to heaviest, then mail kept from an
// earlier look; within each, the sooner date, then the oldest.
export function order(items: Item[], now: number) {
  const rank = (i: Item) => (when(i.lines, now)?.tone === "soon" ? 0 : i.kept ? 6 : i.lines ? 1 + ["none", "quick", "reply", "work"].indexOf(i.lines.verdict) : 5);
  const due = (i: Item) => i.lines?.due ?? "9999-12-31";
  return [...items].sort((a, b) => rank(a) - rank(b) || due(a).localeCompare(due(b)) || a.mail.date - b.mail.date);
}

// Which mail a look takes: a date first, soonest first; then an upset sender; then what asks
// something of him, oldest first. Nothing to do only fills places left over.
export function pick(items: Item[]) {
  const group = (i: Item) => (i.lines?.due && i.lines.verdict !== "none" ? 0 : i.lines?.upset ? 1 : i.lines?.verdict === "none" ? 3 : 2);
  const due = (i: Item) => (group(i) ? "" : i.lines!.due!);
  return [...items].sort((a, b) => group(a) - group(b) || due(a).localeCompare(due(b)) || a.mail.date - b.mail.date);
}

// This look and what waits. The five are picked, then shown in order(); once he starts, the set
// is fixed and decided mail leaves it.
export function compose(people: Item[], day: Day, now: number) {
  const open = people.filter((i) => !day.handled[i.mail.key]);
  if (day.closed) return { look: [], waiting: pick(open) };
  if (!day.set.length) {
    const chosen = pick(open);
    return { look: order(chosen.slice(0, LOOK), now), waiting: chosen.slice(LOOK) };
  }
  const look = day.set.map((k) => open.find((i) => i.mail.key === k)).filter((i) => i !== undefined);
  return { look, waiting: pick(open.filter((i) => !day.set.includes(i.mail.key))) };
}

export const newDay = (now: number): Day => ({ day: isoDay(now), set: [], handled: {}, dues: {}, cleared: 0, started: 0, ended: 0, closed: false, left: 0 });
export const freshState = (now: number): MailState => ({ start: 0, days: 7, ran: 0, kinds: {}, kept: {}, read: {}, senders: {}, today: newDay(now) });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// Stored state, checked loosely; lines older than 14 days go, and a new day starts a new log.
export function parseState(raw: string | null, now: number): MailState {
  let v: unknown;
  try {
    v = JSON.parse(raw || "null");
  } catch {
    v = null;
  }
  const s = freshState(now);
  if (!isObject(v)) return s;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const read = isObject(v.read) ? Object.fromEntries(Object.entries(v.read).filter(([, r]) => isObject(r) && now - num(r.at) < KEEP_LINES)) : {};
  const today = isObject(v.today) && v.today.day === s.today.day && Array.isArray(v.today.set) && isObject(v.today.handled) ? { ...s.today, ...(v.today as Day) } : s.today;
  return { ...s, start: num(v.start), days: num(v.days) || 7, ran: num(v.ran), kinds: isObject(v.kinds) ? (v.kinds as MailState["kinds"]) : {}, kept: isObject(v.kept) ? (v.kept as MailState["kept"]) : {}, read: read as MailState["read"], senders: isObject(v.senders) ? (v.senders as MailState["senders"]) : {}, today: { ...today, dues: isObject(today.dues) ? today.dues : {} } };
}

// What Today's row and Mail home say, from one picture of the mail.
export type Account = { account: string; email: string; kind: Kind; out: boolean; inbox?: number };
// later: mail kept for later today.
export type Snapshot = { now: number; accounts: Account[]; started: boolean; days: number; reading: boolean; unread: string; ran: number; offline: boolean; look: Item[]; waiting: Item[]; rest: Item[]; later: Item[]; today: Day };
export type State = "none" | "first" | "reading" | "needs" | "away" | "started" | "rest" | "unread" | "done" | "paused" | "due";
// The row is lead (strong) · rest; Mail home is title over line, with small beside its button.
export type Said = { state: State; lead: string; rest: string; title: string; line: string; small: string; signedOut: string[] };

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const s = (n: number) => (n === 1 ? "" : "s");
const mins = (n: number) => `${n} minute${s(n)}`;
export const took = (d: Day, now: number) => Math.max(1, Math.ceil(((d.ended || now) - d.started) / 60_000));
// "1 replied, 1 task, 1 done, 1 kept for later, 22 cleared"
export function did(d: Day) {
  const n = (o: Outcome) => Object.values(d.handled).filter((x) => x === o).length;
  return [n("replied") && `${n("replied")} replied`, n("task") && `${n("task")} task${s(n("task"))}`, n("done") && `${n("done")} done`, n("later") && `${n("later")} kept for later`, d.cleared && `${d.cleared} cleared`].filter(Boolean).join(", ");
}

// The nearest date ahead among these mails, in a row's words and a sentence's.
function nearest(items: Item[], now: number) {
  const ahead = items.map((i) => i.lines?.due).filter((d): d is string => !!d && daysTo(d, now) >= 0).sort();
  const on = (n: number) => ahead.filter((d) => daysTo(d, now) === n).length;
  const [today, tomorrow] = [on(0), on(1)];
  const is = (k: number) => `${word(k)} ${k === 1 ? "is" : "are"} due`;
  if (today) return { row: `${is(today)} today`, line: `${cap(is(today))} today`, away: `${cap(word(today))} ${today === 1 ? "needs" : "need"} an answer today` };
  if (tomorrow) return { row: `${is(tomorrow)} tomorrow`, line: `${cap(is(tomorrow))} tomorrow`, away: `${cap(is(tomorrow))} tomorrow` };
  if (!ahead.length) return { row: "no deadlines", line: "There are no deadlines", away: "There are no deadlines" };
  const at = dateOf(ahead[0]), week = daysTo(ahead[0], now) < 7;
  const short = week ? DAYS[at.getDay()] : `${MONTHS[at.getMonth()]} ${at.getDate()}`, long = week ? WEEKDAYS[at.getDay()] : short;
  return { row: `nothing due before ${short}`, line: `Nothing is due before ${long}`, away: `Nothing is due before ${long}` };
}
// The nearest date he still has after a look: mail kept for later, and tasks made today.
export function nextDue(x: Pick<Snapshot, "later" | "today" | "now">) {
  const dates = [...x.later.map((i) => i.lines?.due), ...Object.values(x.today.dues)].filter((d): d is string => !!d && daysTo(d, x.now) >= 0).sort();
  if (!dates.length) return "";
  const n = daysTo(dates[0], x.now);
  return n === 0 ? " One thing is still due today." : ` Nothing left is due before ${n === 1 ? "tomorrow" : shortDay(dates[0])}.`;
}

export function say(x: Snapshot): Said {
  const live = x.accounts.filter((a) => !a.out);
  const kinds = (["personal", "work"] as const).filter((k) => live.some((a) => a.kind === k));
  const kindWords = kinds.map((k) => LABEL[k]).join(" and ");
  const signedOut = x.accounts.filter((a) => a.out).map((a) => `${x.accounts.filter((b) => b.kind === a.kind).length > 1 ? a.email : `${LABEL[a.kind]} mail`} needs reconnecting`);
  const only = signedOut.length && kinds.length === 1 ? ` This is your ${kinds[0]} mail only.` : "";
  const small = x.offline ? (x.ran ? `You're offline. Read for you at ${clock(x.ran)}.` : "You're offline.") : x.unread ? `Sorted by sender only · ${kindWords}` : x.ran ? `Read for you at ${clock(x.ran)} · ${kindWords}` : "";
  const said = (state: State, lead: string, rest: string, title: string, line = ""): Said => ({ state, lead, rest, title, line: line && `${line}${only}`, small, signedOut });
  if (!x.accounts.length) return said("none", "", "", "");
  if (!x.started) {
    const waiting = x.accounts.reduce((n, a) => n + (a.inbox ?? 0), 0);
    const inboxes = x.accounts.length === 1 ? "inbox" : `${word(x.accounts.length)} inboxes`;
    return { ...said("first", "Mail is connected", `start fresh from the last ${x.days} days`, "Start fresh"), line: `${waiting.toLocaleString("en-US")} mail${s(waiting)} ${waiting === 1 ? "is" : "are"} in your ${inboxes}.` };
  }
  const all = [...x.look, ...x.waiting];
  // Before its first run, and unless it said why it can't, the reader is about to read.
  if (!x.ran && !x.unread && !all.length && !x.rest.length && !x.today.started) return said("reading", "", "Reading your mail…", `Reading the last ${x.days} days`, "This takes about a minute. Today shows the result.");
  const d = x.today;
  if (d.closed) {
    const due = all.filter((i) => i.lines?.due === isoDay(x.now) && !d.set.includes(i.mail.key)).length;
    if (due) return said("due", `${due} new ${due === 1 ? "needs" : "need"} an answer today`, "", `${due} new ${due === 1 ? "needs" : "need"} an answer today`);
    // Mail he kept today comes back on its day.
    const kept = x.later.filter((i) => i.lines?.due && daysTo(i.lines.due, x.now) === 0).length;
    if (kept) return said("due", `${kept} ${kept === 1 ? "is" : "are"} due today`, `you kept ${kept === 1 ? "it" : "them"} for later`, `${kept} ${kept === 1 ? "is" : "are"} due today`, `You kept ${kept === 1 ? "it" : "them"} for later.`);
    const handled = Object.keys(d.handled).length;
    if (d.left) return said("paused", "Mail done for now", `${handled} handled · ${d.left} for the next look`, "Mail is done for now", `${handled} handled. ${d.left} more wait${d.left === 1 ? "s" : ""} for the next look.`);
    const done = did(d);
    return { ...said("done", "Mail done", [done, `${took(d, x.now)} min`].filter(Boolean).join(" · "), "Mail is done for today", `${done ? `${done}. ` : ""}It took ${mins(took(d, x.now))}.${nextDue(x)}`), small: "New mail waits for tomorrow's look. Anything that cannot wait shows up on Today." };
  }
  if (d.set.length && x.look.length && Object.keys(d.handled).some((k) => d.set.includes(k)))
    return said("started", `${x.look.length} left`, "pick up where you stopped", `${x.look.length} left`, "Pick up where you stopped.");
  const n = all.length;
  if (!n) return x.rest.length ? said("rest", "Nothing needs you", `${x.rest.length} other${s(x.rest.length)} to clear`, "Nothing needs you") : said("none", "", "", "Nothing needs you", "There is nothing new.");
  if (all.every((i) => !i.lines)) {
    if (!x.unread) return said("unread", `${n} new from people`, "not read for you yet", `${n} new from people`, "You can read these while their summaries are being prepared.");
    return said("unread", `${n} new from people`, "not read for you yet", `${n} new from people`, `LeadingLight could not read these for you.${x.unread ? ` ${x.unread}` : ""}`);
  }
  const m = minutes(x.look);
  const need = `${n} ${n === 1 ? "needs" : "need"} you`;
  const date = nearest(all, x.now);
  if (n > LOOK) return said("away", need, `start with ${LOOK}, about ${m} min · ${date.row}`, need, `${date.away}. The ${LOOK} that matter most take about ${mins(m)}.`);
  // Plain facts: who is upset only when someone is. The row is cut from its end, so it goes count, minutes, date, mood.
  const upset = x.look.find((i) => i.lines?.upset)?.lines;
  const mood = upset?.tone ? ` · ${upset.tone.split(/(?<=\.)\s/)[0].replace(/\.$/, "")}` : "";
  const line = upset ? `About ${mins(m)}. ${upset.worry}. ${date.line}.` : `About ${mins(m)}. ${date.line}.`;
  return said("needs", need, `about ${m} min · ${date.row}${mood}`, need, line);
}

// The end of a look (design 5.5).
export function ending(x: Snapshot) {
  const w = x.waiting.length;
  if (!w) return { title: "That's everything", line: `${did(x.today) ? `${did(x.today)}. ` : ""}It took ${mins(took(x.today, x.now))}.${nextDue(x)}` };
  return { title: `${Object.keys(x.today.handled).length} done`, line: `${w} more wait${w === 1 ? "s" : ""} for the next look.` };
}

// The rest's headline and its groups' counts (design 5.2 and 5.4).
export const GROUPS: Group[] = ["Receipts", "Newsletters", "Notifications", "Other"];
export function restWords(rest: Item[], read: boolean) {
  const n = rest.length;
  const groups = GROUPS.map((name) => {
    // Newest first, as an inbox reads.
    const items = rest.filter((i) => (i.group ?? ruleGroup(i.mail)) === name).sort((a, b) => b.mail.date - a.mail.date);
    return { name, items, senders: [...new Set(items.map((i) => i.mail.name))] };
  }).filter((g) => g.items.length);
  const counts = groups.map((g) => `${g.items.length} ${g.name === "Other" ? "other" : g.name.toLowerCase().replace(/s$/, g.items.length === 1 ? "" : "s")}`).join(" · ");
  return { headline: read ? `${n} other${s(n)}, nothing to do` : `${n} other${s(n)} that look${n === 1 ? "s" : ""} automated`, counts, groups };
}
