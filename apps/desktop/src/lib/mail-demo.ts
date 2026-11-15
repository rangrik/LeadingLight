import { CloudError } from "./cloud";
import type { MailSummary } from "./gmail";
import type { Source } from "./mail";
import { freshState, type Group, isoDay, type Lines, mailKey, type Read } from "./mail-rules";

// Mail for the dev build only (?mail=demo, loaded by lib/mail.ts): the people and lines in
// the design's screenshots, and 22 others, changed in memory. &day=hard, away, unread, reconnect or first.

const WORK = "demo-work", HOME = "demo-personal";
const ACCOUNTS = [{ account: HOME, email: "pranav.k@gmail.com", inbox: 11902 }, { account: WORK, email: "pranav@northlane.io", inbox: 2334 }];
const DAY = 86_400_000;
// ago: days before today; due: days after today (below 0, passed). to and replyTo default to the account and none.
type Person = { id: string; account: string; from: string; at: [number, number]; ago?: number; to?: string; replyTo?: string; subject: string; body: string; files?: { name: string; size: number }[]; lines: Omit<Lines, "upset" | "replies" | "due"> & { due?: number; upset?: boolean; replies?: [string, string][] } };
const draft = (...lines: string[]) => lines.join("\n\n");
const PEOPLE: Person[] = [
  { id: "arjun", account: WORK, from: "Arjun Rao <arjun@northlane.io>", at: [11, 42], subject: "Expense claim OCT-0412 approved", body: draft("Hi Pranav,", "Your claim OCT-0412 has been approved in full. It will go out with the November salary run on the 30th.", "No action needed from your side.", "Arjun"),
    lines: { verdict: "none", headline: "Your October expense claim was approved", happened: "Arjun in Finance approved your October expense claim in full.", stands: "It will be paid with your salary on November 30. There is nothing more to file.", part: "Nothing." } },
  { id: "meera", account: WORK, from: "Meera Iyer <meera@northlane.io>", at: [14, 14], subject: "Re: Design review on Thursday", body: draft("Hi Pranav,", "Something landed on my calendar at 2 on Thursday that I can't move. Could we start the design review at 4 instead? Same room, same agenda.", "I'll hold 4 for now. Tell me if that doesn't work.", "Meera"),
    lines: { verdict: "quick", due: 4, headline: "Meera wants to move Thursday's review to 4 pm", happened: "Meera has a clash at 2 pm on Thursday. She asked to start the design review at 4 pm instead.", stands: "The review is on Thursday, so she needs to know the day before. She is holding 4 pm until you answer.", part: "Say yes, or offer another time.",
      replies: [["4 pm works", draft("Hi Meera,", "4 pm on Thursday works for me. See you then.", "Pranav")], ["Not 4 pm, try Friday", draft("Hi Meera,", "I can't do 4 pm on Thursday. Could we do Friday morning instead? Any time before noon works.", "Pranav")]] } },
  { id: "sunita", account: HOME, from: "Sunita Kulkarni <sunita.kulkarni@gmail.com>", at: [9, 5], subject: "Flat 302 agreement renewal", body: draft("Dear Pranav,", "Your agreement for flat 302 ends on 30 November. We are happy to renew for 11 months. As we discussed last year, the rent will go up by 5% from December.", "Please let me know by Friday the 20th so that I can ask the agent to prepare the agreement.", "Regards,", "Sunita Kulkarni"),
    lines: { verdict: "reply", due: 6, headline: "Sunita asks if you will renew the flat", happened: "Your rental agreement ends on November 30. Sunita offered to renew for 11 months with a 5% rise in rent.", stands: "She needs your answer by Friday, November 20, so the new agreement is ready in time.", part: "Tell her if you will renew, and if the new rent is fine.",
      replies: [["Yes, renew", draft("Hello Mrs Kulkarni,", "Yes, I would like to renew for 11 months on the terms you mentioned. Please go ahead with the agreement and tell me when to come and sign.", "Thank you,\nPranav")], ["Yes, but ask about the rent", draft("Hello Mrs Kulkarni,", "I would like to renew for another 11 months. Would you consider keeping the rent the same this year? I have always paid on time and would like to stay.", "Thank you,\nPranav")]] } },
  { id: "daniel", account: WORK, from: "Daniel Weiss <daniel@northlane.io>", at: [13, 20], subject: "Larkfield: cost estimate for the bulk import", files: [{ name: "larkfield-sample.csv", size: 1_200_000 }], body: draft("Pranav,", "Larkfield are planning to bring over about 2 million records in December. Before they commit, they want to know roughly what it will cost in API calls on their current plan.", "Could you put together an estimate? I'm meeting them on Friday at 11, so anything before then is great. Their sample file is attached.", "Thanks,", "Daniel"),
    lines: { verdict: "work", due: 6, headline: "Daniel needs a cost estimate for Larkfield by Friday", happened: "Larkfield wants to import 2 million records next month. Daniel asked what that will cost them in API calls.", stands: "He meets them on Friday, November 20, at 11 am and wants the number before that. Their sample file is attached.", part: "Work out the estimate and send it to Daniel before Friday.",
      task: { title: "Send Daniel the Larkfield cost estimate", ack: "Got it, Daniel. I'll send the estimate before your Friday call." } } },
  { id: "danielFix", account: WORK, from: "Daniel Weiss <daniel@northlane.io>", at: [12, 48], subject: "Larkfield export is still failing", body: draft("Pranav,", "Larkfield came back to me again this morning about the CSV export. It was meant to be fixed last Friday and it's still failing on their larger accounts. I've now told them twice that it's coming.", "I need a date I can give them today. Just the date.", "Daniel"),
    lines: { verdict: "reply", due: 0, upset: true, tone: "Daniel is frustrated. He is asking for one thing: a date.", worry: "Daniel is frustrated about the export fix, and wants a date", headline: "Daniel wants a date for the export fix", happened: "The export fix you expected to ship last Friday is not out. Larkfield raised it with Daniel again this morning.", stands: "Daniel has to answer them today. He is not asking why it slipped.", part: "Give him a date he can pass on.",
      replies: [["It ships Tuesday", draft("Hi Daniel,", "Sorry this slipped. The fix ships on Tuesday, November 17. I'll message you the moment it is live so you can tell Larkfield.", "Pranav")], ["I need until Wednesday", draft("Hi Daniel,", "Sorry this slipped. I need until Wednesday, November 18, to ship it properly. You can give Larkfield that date, and I'll confirm as soon as it is live.", "Pranav")]] } },
  { id: "thanks", account: WORK, from: "Meera Iyer <meera@northlane.io>", at: [9, 12], subject: "Re: Handoff notes", body: draft("Pranav,", "Just read the handoff notes. They answered every question I had, thank you. I'll start on Monday.", "Meera"),
    lines: { verdict: "none", headline: "Meera says thanks for the handoff notes", happened: "Meera read your handoff notes and said they answered all her questions.", stands: "She has what she needs to start on Monday.", part: "Nothing." } },
  { id: "dentist", account: HOME, from: "Asha at Smile Dental <asha@smiledental.in>", at: [10, 30], subject: "Your appointment on Saturday 21 November", body: draft("Hello Pranav,", "This is a reminder of your cleaning appointment on Saturday 21 November at 11:30 am with Dr Shah.", "Please reply to confirm by Wednesday, or tell us if you need another time.", "Asha", "Smile Dental"),
    lines: { verdict: "quick", due: 4, headline: "The dentist asks you to confirm Saturday at 11:30", happened: "Smile Dental has you booked for a cleaning on Saturday, November 21, at 11:30 am.", stands: "They hold the slot until Wednesday. After that they give it to someone else.", part: "Confirm, or ask for another time.",
      replies: [["Confirm", draft("Hi Asha,", "Yes, Saturday the 21st at 11:30 works. See you then.", "Pranav")], ["Ask for another time", draft("Hi Asha,", "I can't make Saturday the 21st. Do you have anything the following Saturday morning?", "Pranav")]] } },
  { id: "trek", account: HOME, from: "Rohan Patil <rohan.patil@gmail.com>", at: [20, 21], ago: 2, subject: "Trek in December?", body: draft("Hey,", "Thinking of a day trek on a Saturday in December. Are you in? No date yet, tell me which Saturdays work for you.", "Rohan"),
    lines: { verdict: "quick", headline: "Rohan wants to plan a trek in December", happened: "Rohan wants to do a day trek on a Saturday in December and is asking who is in.", stands: "He has not picked a date yet. Nothing is booked.", part: "Say if you are interested.",
      replies: [["I'm in", draft("Hey Rohan,", "I'm in. Any Saturday in December works for me except the 19th.", "Pranav")], ["Not this time", draft("Hey Rohan,", "I'll skip this one. Have a great trek, and send photos.", "Pranav")]] } },
  { id: "call", account: WORK, from: "Daniel Weiss <daniel@northlane.io>", at: [17, 30], ago: 3, subject: "Larkfield call on Friday", body: draft("Pranav,", "I have Larkfield on Friday at 11. Could you join for the last 20 minutes? They will have technical questions.", "No problem if not, I'll take notes.", "Daniel"),
    lines: { verdict: "none", due: -1, headline: "Daniel asked you to join the Larkfield call", happened: "Daniel asked if you could join yesterday's call with Larkfield for the technical questions.", stands: "The call was yesterday. He said he would take notes if you could not come.", part: "Nothing." } },
  { id: "health", account: WORK, from: "Kavya Menon <kavya.menon@northlane.io>", at: [10, 2], ago: 3, to: "everyone@northlane.io", replyTo: "People team <people@northlane.io>", subject: "Choose your health plan by November 25", files: [{ name: "health-plans-2027.pdf", size: 310_000 }], body: draft("Hi all,", "It is time to choose your health plan for next year. The two options are in the attached sheet. Please reply with your choice by 25 November.", "If we don't hear from you, you stay on your current plan.", "Kavya"),
    lines: { verdict: "reply", due: 11, headline: "Kavya needs your health plan choice", happened: "The yearly health plan choice is open. Kavya sent the two options and asked everyone to pick one.", stands: "Replies go to the people team. If you don't answer by the 25th, you stay on your current plan.", part: "Reply with the plan you want, or do nothing to keep the one you have.",
      replies: [["Keep my current plan", draft("Hi Kavya,", "Please keep me on my current plan for next year.", "Thanks,\nPranav")], ["Switch to the family plan", draft("Hi Kavya,", "Please move me to the family plan for next year.", "Thanks,\nPranav")]] } },
  { id: "tax", account: HOME, from: "Neha Joshi <neha@joshitax.in>", at: [16, 45], ago: 4, subject: "Papers for this year's filing", body: draft("Hi Pranav,", "I'm starting on this year's filing. I need four things from you by 30 November: your salary statement, rent receipts, the two investment statements, and last year's return.", "Send them whenever you have them together.", "Neha"),
    lines: { verdict: "work", due: 16, headline: "Your accountant needs your tax papers", happened: "Neha is starting this year's tax filing and listed the papers she needs from you.", stands: "She needs them by the 30th to file on time. The list is four items long.", part: "Gather the four papers and send them to Neha.",
      task: { title: "Send Neha the tax papers", ack: "Thanks, Neha. I'll send everything by the 30th." } } },
  { id: "photos", account: HOME, from: "Rohan Patil <rohan.patil@gmail.com>", at: [21, 14], ago: 5, subject: "Photos from Sunday", body: draft("Here you go, all 40 of them. Link is good for a month.", "Rohan"),
    lines: { verdict: "none", headline: "Rohan sent the photos from Sunday", happened: "Rohan shared a link to the photos from Sunday's lunch.", stands: "The link stays up for a month.", part: "Nothing." } },
];
// Addresses writing for the first time.
const FIRST = ["asha@smiledental.in"];
// reconnect: Google has signed the work account out.
const DAYS: Record<string, string[]> = { normal: ["arjun", "meera", "sunita", "daniel"], reconnect: ["sunita"], hard: ["danielFix", "thanks", "dentist"], away: ["arjun", "meera", "dentist", "sunita", "daniel", "thanks", "trek", "call", "health", "tax", "photos"], unread: ["arjun", "meera", "sunita", "daniel"], first: ["arjun", "meera", "sunita", "daniel"] };
// [sender, subject, days ago, account]
const REST: [Group, [string, string, number, string][]][] = [
  ["Receipts", [["Amazon", "Your order has shipped", 0, HOME], ["Uber", "Your Friday evening trip", 1, HOME], ["Apple", "Your receipt from Apple", 1, HOME], ["Stripe", "Receipt for Northlane, November", 1, WORK], ["AWS", "Your October invoice is ready", 2, WORK], ["Zomato", "Your order from Vohuman Cafe", 2, HOME], ["Airtel", "Your bill has been paid", 3, HOME], ["Notion", "Receipt for your workspace", 3, WORK], ["BookMyShow", "Your tickets for Saturday", 4, HOME]]],
  ["Newsletters", [["The Pragmatic Engineer", "What changed in code review this year", 0, WORK], ["Dense Discovery", "Issue 364", 1, HOME], ["TLDR", "Friday's top stories in tech", 1, WORK], ["Hacker Newsletter", "Issue 771", 1, HOME], ["Tauri", "Tauri 2.9 release notes", 2, WORK], ["Lenny's Newsletter", "How to say no at work", 2, HOME], ["Product Hunt", "Yesterday's top products", 3, HOME], ["Changelog", "This week in open source", 4, WORK]]],
  ["Notifications", [["GitHub", "[leadinglight] Tests passed on main", 0, HOME], ["Vercel", "Your deployment is ready", 0, HOME], ["Google Calendar", "Reminder: Design review on Thursday", 0, WORK], ["LinkedIn", "3 people viewed your profile", 1, HOME], ["Figma", "Meera commented on Import flow", 1, WORK]]],
];

export function demoSource(): Source {
  const day = new URLSearchParams(location.search).get("day") ?? "normal";
  const midnight = new Date().setHours(0, 0, 0, 0), iso = (n: number) => isoDay(midnight + n * DAY + DAY / 2);
  type Entry = { account: string; summary: MailSummary; body: string; files?: Person["files"]; lines?: Lines; group?: Group };
  const inbox: Entry[] = [];
  for (const p of PEOPLE.filter((p) => (DAYS[day] ?? DAYS.normal).includes(p.id))) {
    const { replies = [], due, upset = false, ...rest } = p.lines;
    const lines: Lines = { ...rest, upset, replies: replies.map(([label, text]) => ({ label, text })), ...(due !== undefined && { due: iso(due) }), ...(rest.task && { task: { ...rest.task, due: iso(due ?? 0) } }) };
    const summary = { id: p.id, threadId: `t-${p.id}`, subject: p.subject, from: p.from, to: p.to ?? ACCOUNTS.find((a) => a.account === p.account)!.email, cc: "", replyTo: p.replyTo ?? "", date: new Date(midnight - (p.ago ?? 0) * DAY).setHours(...p.at), snippet: p.body.split("\n\n")[1], unread: true, labels: ["INBOX", "UNREAD"], unsubscribe: false };
    inbox.push({ account: p.account, summary, body: p.body, files: p.files, lines });
  }
  REST.forEach(([group, list]) => list.forEach(([name, subject, ago, account], n) => {
    const id = `${group}-${n}`.toLowerCase(), label = group === "Newsletters" ? "CATEGORY_PROMOTIONS" : "CATEGORY_UPDATES";
    const summary = { id, threadId: `t-${id}`, subject, from: `${name} <hello@${name.toLowerCase().replace(/[^a-z]/g, "")}.example>`, to: ACCOUNTS.find((a) => a.account === account)!.email, cc: "", replyTo: "", date: midnight - ago * DAY + (8 + n) * 3_600_000, snippet: subject, unread: true, labels: ["INBOX", "UNREAD", label], unsubscribe: group === "Newsletters" };
    inbox.push({ account, summary, body: subject, group });
  }));
  const thread = (account: string, threadId: string) => inbox.filter((e) => e.account === account && e.summary.threadId === threadId);
  const sent: { account: string; id: string; text: string }[] = [];
  (window as unknown as { __mailDemo: object }).__mailDemo = { inbox, sent };
  return {
    demo: true,
    cannot: day === "unread" ? "Claude is at its limit until 6 PM." : undefined,
    accounts: async () => ACCOUNTS.map(({ account, email }) => ({ account, email })),
    async messages(account, after) {
      if (day === "reconnect" && account === WORK) throw new CloudError("Gmail access expired. Reconnect this account.", 401);
      return inbox.filter((e) => e.account === account && e.summary.labels.includes("INBOX") && e.summary.date >= after).map((e) => ({ ...e.summary }));
    },
    thread: async (account, threadId) => thread(account, threadId).map((e) => ({ from: e.summary.from, date: e.summary.date, text: e.body, files: e.files })),
    counts: async (account) => ACCOUNTS.find((a) => a.account === account)?.inbox ?? 0,
    async modify(account, threadId, add, remove) {
      const found = thread(account, threadId);
      if (!found.length || !found.some((e) => e.summary.labels.includes("INBOX") || add.includes("INBOX"))) throw new CloudError("This message is no longer available.", 404);
      for (const e of found) e.summary.labels = [...new Set([...e.summary.labels.filter((l) => !remove.includes(l as never)), ...add])];
    },
    send: async (account, id, text) => void sent.push({ account, id, text }),
    sent: async (_account, address) => (FIRST.includes(address) ? 1 : 2),
    seed: (now) => ({ ...freshState(now), ...(day !== "first" && { start: now - 7 * DAY, ran: day === "unread" ? 0 : now - 4 * 60_000, read: Object.fromEntries(inbox.filter(() => day !== "unread").map((e) => [mailKey(e.account, e.summary.id), read(e, now)])) }) }),
    reads: (keys, now) => Object.fromEntries(inbox.filter((e) => keys.includes(mailKey(e.account, e.summary.id))).map((e) => [mailKey(e.account, e.summary.id), read(e, now)])),
  };
}
const read = (e: { lines?: Lines; group?: Group }, at: number): Read => (e.lines ? { at, lines: e.lines } : { at, group: e.group });
