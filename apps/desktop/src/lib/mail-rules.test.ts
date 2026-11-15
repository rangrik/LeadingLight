import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, compose, pick, conversations, ending, fromPeople, type Item, type Lines, type Mail, newDay, order, replyAddress, say, type Snapshot, type Verdict, when } from "./mail-rules.ts";

const now = new Date(2026, 10, 14, 15, 2).getTime();
let n = 0;
const mail = (o: Partial<Mail> = {}): Mail => ({ key: `k${++n}`, account: "w", email: "pranav@northlane.io", kind: "work", id: `${n}`, threadId: `${n}`, from: "", name: "Meera Iyer", address: "meera@northlane.io", subject: "", to: "", cc: "", replyTo: "", snippet: "", date: new Date(2026, 10, 14, 9, n).getTime(), unread: true, labels: ["INBOX"], unsubscribe: false, ...o });
const lines = (verdict: Verdict, o: Partial<Lines> = {}): Lines => ({ verdict, headline: "h", happened: "a", stands: "b", part: "c", upset: false, replies: [], ...o });
const item = (l?: Lines, o: Partial<Item> = {}): Item => ({ mail: mail(), lines: l, kept: false, ...o });
const accounts: Snapshot["accounts"] = [{ account: "p", email: "pranav.k@gmail.com", kind: "personal", out: false }, { account: "w", email: "pranav@northlane.io", kind: "work", out: false }];
const snap = (look: Item[], o: Partial<Snapshot> = {}): Snapshot => ({ now, accounts, started: true, days: 7, reading: false, unread: "", ran: new Date(2026, 10, 14, 14, 58).getTime(), offline: false, look, waiting: [], rest: [], later: [], today: newDay(now), ...o });
const row = (s: Snapshot) => { const x = say(s); return [x.lead, x.rest, x.title, x.line]; };
const normal = () => [item(lines("none")), item(lines("quick", { due: "2026-11-18" })), item(lines("reply", { due: "2026-11-20" })), item(lines("work", { due: "2026-11-20" }))];

// Seam: the rule sort decides what reaches him at all; a person sorted as noise is missed mail.
test("mail from people, and the rest", () => {
  assert.equal(fromPeople(mail()), true);
  assert.equal(fromPeople(mail({ address: "norah@example.com" })), true);
  assert.equal(fromPeople(mail({ address: "pranav.k@gmail.com" }), ["pranav.k@gmail.com"]), false);
  for (const m of [{ labels: ["INBOX", "CATEGORY_UPDATES"] }, { unsubscribe: true }, { address: "no-reply@github.com" }, { address: "noreply@x.io" }, { address: "do-not-reply@bank.in" }]) assert.equal(fromPeople(mail(m)), false);
});

// Seam: the look's order and size are the promise that it ends.
test("the look: due today or tomorrow first, light to heavy, sooner first, kept last, five at most", () => {
  const kept = item(lines("none"), { kept: true }), due = item(lines("work", { due: "2026-11-14" })), unread = item();
  const [none, quick, reply, work] = normal();
  assert.deepEqual(order([kept, unread, work, reply, quick, none, due], now), [due, none, quick, reply, work, unread, kept]);
  const [undated, later, sooner, tomorrow, keptTomorrow] = [item(lines("reply")), item(lines("reply", { due: "2026-11-30" })), item(lines("reply", { due: "2026-11-17" })), item(lines("work", { due: "2026-11-15" })), item(lines("quick", { due: "2026-11-15" }), { kept: true })];
  assert.deepEqual(order([undated, later, keptTomorrow, sooner, none, tomorrow], now), [tomorrow, keptTomorrow, none, sooner, later, undated]);
  // Seam: after days away the five are what matters, not the lightest: dates, upset, asks, then Nothing to do.
  const upset = item(lines("reply", { upset: true })), [n1, n2, n3] = [item(lines("none")), item(lines("none")), item(lines("none"))];
  assert.deepEqual(pick([n1, n2, n3, undated, upset, later, sooner]), [sooner, later, upset, undated, n1, n2, n3]);
  const people = [kept, unread, work, reply, quick, none, due];
  assert.deepEqual(compose(people, newDay(now), now).look, [due, quick, reply, work, unread]);
  const day = { ...newDay(now), set: [due, none, quick].map((i) => i.mail.key), handled: { [due.mail.key]: "done" as const } };
  assert.deepEqual(compose(people, day, now), { look: [none, quick], waiting: [reply, work, unread, kept] });
});

// Seam: Today's row and Mail home are the one door; a wrong sentence is the feature failing.
test("the words for Today and Mail home", () => {
  assert.deepEqual(row(snap(normal())), ["4 need you", "about 5 min · nothing due before Wed", "4 need you", "About 5 minutes. Nothing is due before Wednesday."]);
  assert.equal(say(snap(normal())).small, "Read for you at 2:58 PM · Personal and Work");
  assert.deepEqual(row(snap([item(lines("reply")), item(lines("none"))])).slice(1, 4), ["about 3 min · no deadlines", "2 need you", "About 3 minutes. There are no deadlines."]);
  assert.equal(say(snap([item(lines("work", { due: "2026-11-30" }))])).rest, "about 1 min · nothing due before Nov 30");
  assert.equal(say(snap([item(lines("quick", { due: "2026-11-15" }))])).rest, "about 1 min · one is due tomorrow");
  const upset = lines("reply", { due: "2026-11-14", upset: true, tone: "Daniel is frustrated. He is asking for one thing: a date.", worry: "Daniel is frustrated about the export fix, and wants a date" });
  assert.deepEqual(row(snap([item(upset), item(lines("none")), item(lines("quick"))])).slice(1, 4), ["about 4 min · one is due today · Daniel is frustrated", "3 need you", "About 4 minutes. Daniel is frustrated about the export fix, and wants a date. One is due today."]);
  const five = [item(lines("none")), item(lines("quick", { due: "2026-11-18" })), item(lines("quick")), item(lines("reply")), item(lines("work"))];
  const away = snap(five, { waiting: Array.from({ length: 6 }, () => item(lines("none"))) });
  assert.deepEqual(row(away), ["11 need you", "start with 5, about 6 min · nothing due before Wed", "11 need you", "Nothing is due before Wednesday. The 5 that matter most take about 6 minutes."]);
  away.waiting[0].lines!.due = "2026-11-14";
  assert.match(say(away).line, /^One needs an answer today\. /);
  assert.deepEqual(row(snap(normal().map((i) => ({ ...i, lines: undefined })), { unread: "Claude is at its limit until 6 PM." })), ["4 new from people", "not read for you yet", "4 new from people", "LeadingLight could not read these for you. Claude is at its limit until 6 PM."]);
  assert.deepEqual(row(snap([], { rest: normal() })).slice(0, 2), ["Nothing needs you", "4 others to clear"]);
  assert.deepEqual(say(snap([])).line, "There is nothing new.");
  const started = new Date(2026, 10, 14, 14, 58).getTime(), ended = new Date(2026, 10, 14, 15, 1, 30).getTime();
  const done = { ...newDay(now), closed: true, started, ended, cleared: 22, handled: { a: "replied" as const, b: "task" as const, c: "done" as const, d: "later" as const } };
  assert.deepEqual(row(snap([], { today: done })), ["Mail done", "1 replied, 1 task, 1 done, 1 kept for later, 22 cleared · 4 min", "Mail is done for today", "1 replied, 1 task, 1 done, 1 kept for later, 22 cleared. It took 4 minutes."]);
  // The end names the nearest date he still has: kept mail and tasks made today.
  const sunita = item(lines("reply", { due: "2026-11-20" }), { kept: true });
  assert.match(ending(snap([], { today: { ...done, dues: { t: "2026-11-30" } }, later: [sunita] })).line, /It took 4 minutes\. Nothing left is due before Fri, Nov 20\.$/);
  const daniel = item(upset, { kept: true });
  assert.deepEqual(row(snap([], { today: done, later: [daniel] })).slice(0, 3), ["1 is due today", "you kept it for later", "1 is due today"]);
  assert.match(ending(snap([], { today: done, later: [daniel] })).line, /One thing is still due today\.$/);
  assert.deepEqual(row(snap([], { today: { ...done, left: 6 } })).slice(0, 2), ["Mail done for now", "4 handled · 6 for the next look"]);
  assert.deepEqual(row(snap([], { started: false, accounts: [{ ...accounts[0], inbox: 11902 }, { ...accounts[1], inbox: 2334 }] })), ["Mail is connected", "start fresh from the last 7 days", "Start fresh", "14,236 mails are in your two inboxes."]);
  const out = say(snap([item(lines("reply"))], { accounts: [accounts[0], { ...accounts[1], out: true }] }));
  assert.deepEqual([out.signedOut, out.line], [["Work mail needs reconnecting"], "About 3 minutes. There are no deadlines. This is your personal mail only."]);
});

// Seam: date words come from day arithmetic; an off-by-one at midnight or a daylight-saving
// change would call a mail "Today" a day early, or count the wrong days left.
test("the date tag and when a mail came", () => {
  const tag = (due: string | undefined, verdict: Verdict = "reply", at = now) => when(lines(verdict, { due }), at);
  assert.deepEqual([tag("2026-11-14")?.text, tag("2026-11-15")?.text, tag("2026-11-20")?.text, tag(undefined)?.text, tag(undefined, "none")], ["Today", "Tomorrow", "By Fri, Nov 20 · 6 days left", "No deadline", undefined]);
  assert.deepEqual([tag("2026-11-13")?.tone, tag("2026-11-13", "none")?.tone, tag("2026-11-13")?.text], ["soon", "quiet", "Was Fri, Nov 13"]);
  assert.equal(tag("2026-11-15", "reply", new Date(2026, 10, 14, 23, 59).getTime())?.text, "Tomorrow");
  // US clocks go back on Nov 1, 2026.
  assert.equal(tag("2026-11-03", "reply", new Date(2026, 9, 30, 0, 30).getTime())?.days, 4);
  assert.deepEqual([ago(new Date(2026, 10, 14, 9, 5).getTime(), now), ago(new Date(2026, 10, 12, 20, 0).getTime(), now), ago(new Date(2026, 10, 3).getTime(), now)], ["9:05 AM", "Thu", "Nov 3"]);
  assert.equal(replyAddress(mail({ replyTo: '"People, Team" <people@northlane.io>' })), "people@northlane.io");
  assert.equal(replyAddress(mail()), "meera@northlane.io");
});

// Seam: a conversation of three replies must cost one decision, not three.
test("one item per conversation, newest, unread if any is", () => {
  const [a, b, c] = [mail({ threadId: "t", unread: true }), mail({ threadId: "t", unread: false }), mail({ threadId: "t", account: "p", unread: false })];
  assert.deepEqual(conversations([a, b, c]), [{ ...b, unread: true }, c]);
});
