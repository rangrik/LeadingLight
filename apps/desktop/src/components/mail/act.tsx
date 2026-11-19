import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { toastManager } from "@leadinglight/ui/components/toast";
import { cn } from "@leadinglight/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";
import { dayShown, today } from "~/lib/daily";
import { openExternal } from "~/lib/gmail";
import { clearRest, type Done, done, gmailLink, keep, keepGoing, keptReply, later, mail, MailError, type MailRef, makeTask, putAway, reopenLook, reply, sendAgain } from "~/lib/mail";
import { daysTo, type Item, mailKey, shortDay } from "~/lib/mail-rules";
import { frontTab, leaves, openPage, panes, showIn, travel } from "~/lib/panes";
import { MAIL_LOOK, MAIL_VIEW } from "~/lib/space";
import { createStore } from "~/lib/state";

// The look's place: which mail it shows, its one error line (design 5.3), the day Later put the rest off,
// and rest: opened from the rest's Look, so it shows the rest even while mails wait.
export type Trouble = { key: string; text: string; retry: () => void; gone: boolean; reply?: string };
export const look = createStore<{ key: string; trouble?: Trouble; restOff: string; rest: boolean }>({ key: "", restOff: "", rest: false });
const setLook = (patch: Partial<ReturnType<typeof look.get>>) => look.set({ ...look.get(), ...patch });
// Mounted while a look is on screen, so a late failure knows whether he is still there.
export const lookOpen = { now: false };

export function openLook(key = "", rest = false) {
  setLook({ key, trouble: undefined, rest, ...(rest && { restOff: "" }) });
  openPage(MAIL_LOOK);
}
// Go through; a mail due today after the look closed opens a new one.
export const goThrough = (state: string) => (state === "due" ? run(keepGoing().then(() => openLook())) : openLook());
export const restLater = () => setLook({ restOff: mail.get().today.day });

const leafOf = (pane: string) => {
  const root = panes.get().root;
  return root ? leaves(root).find((l) => l.id === pane) : undefined;
};
// Back where he came from in this pane, or to Mail home when the look opened on its own.
export function back(pane: string) {
  const l = leafOf(pane);
  if (l && frontTab(l).at > 0) travel(-1, pane);
  else showIn(pane, MAIL_VIEW);
}
export function cameFromToday(pane: string) {
  const l = leafOf(pane), t = l && frontTab(l);
  return !!t && t.at > 0 && t.pages[t.at - 1] === dayShown(today());
}

// "2 of 4": decided mail of today's set, then where this one is among those left.
export function place(key: string) {
  const m = mail.get();
  const at = Math.max(0, m.look.findIndex((i) => i.mail.key === key));
  const set = m.today.set.length ? m.today.set : m.look.map((i) => i.mail.key);
  return `${set.filter((k) => m.today.handled[k]).length + at + 1} of ${set.length}`;
}

// A key shown on its button; on a filled button it takes the button's colours.
export const Key = ({ k, filled }: { k: string; filled?: boolean }) => <Kbd className={cn("-me-[5px]", filled && "bg-primary-foreground/16 text-primary-foreground/84")}>{k}</Kbd>;
export function Keyed({ k, children, variant, ...rest }: ComponentProps<typeof Button> & { k: string }) {
  return (
    <Button variant={variant} {...rest}>
      {children}
      <Key filled={!variant || variant === "default"} k={k} />
    </Button>
  );
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
const first = (name: string) => name.split(" ")[0];
// As wide as its words, where the app's toasts already sit.
function toast(text: string, buttons?: ReactNode) {
  return toastManager.add({
    timeout: 8000,
    data: { rootProps: { style: { width: "fit-content", maxWidth: "100%" } } },
    title: (
      <span className="flex items-center gap-3">
        <span className="min-w-0">{text}</span>
        {buttons && <span className="-me-1.5 flex shrink-0 gap-1 font-normal">{buttons}</span>}
      </span>
    ),
  });
}
const again = (retry: () => void) => (
  <Button onClick={retry} size="xs" variant="ghost">
    Try again
  </Button>
);

// The last decision's Undo, for its toast's 8 seconds; Z presses it.
let undoing: { id: string; undo: Done["undo"]; reopen: boolean; key?: string } | null = null;
export const canUndo = () => !!undoing;
export async function undoLast() {
  const u = undoing;
  if (!u) return;
  undoing = null;
  toastManager.close(u.id);
  try {
    if (u.reopen && mail.get().today.closed) await reopenLook();
    if (!(await u.undo())) toast("It was already sent.");
    else if (u.key) setLook({ key: u.key, trouble: undefined });
  } catch (e) {
    toast(why(e));
  }
}
function said(text: string, d: Done, key?: string, open?: () => void) {
  // One Undo at a time: the last decision's.
  if (undoing) toastManager.close(undoing.id);
  const id: string = toast(
    text,
    <>
      {open && (
        <Button onClick={() => (toastManager.close(id), open())} size="xs" variant="ghost">
          Open
        </Button>
      )}
      <Button onClick={() => void undoLast()} size="xs" variant="ghost">
        Undo
        <Key k="Z" />
      </Button>
    </>,
  );
  undoing = { id, undo: d.undo, key, reopen: lookOpen.now || !mail.get().today.closed };
  setTimeout(() => undoing?.id === id && (undoing = null), 8000);
}

// Gmail's side runs behind. A mail that comes back shows its error line when he is still on
// it (nothing decided since); otherwise a toast says so.
let decided = 0;
function behind(i: Item, d: Done, kind: "done" | "reply" | "task", text = "") {
  const at = ++decided;
  d.settled.catch((e: unknown) => {
    const send = e instanceof MailError && e.trouble === "send";
    const kept = keptReply(i.mail.key) ?? text;
    if (kind === "done" || (kind === "reply" && send)) {
      // It came back, so its Undo has nothing left to undo.
      if (undoing?.key === i.mail.key) {
        toastManager.close(undoing.id);
        undoing = null;
      }
      const retry = () => void (send ? doReply(i, kept) : doDone(i)).catch((x) => toast(why(x)));
      if (at === decided && lookOpen.now) return setLook({ key: i.mail.key, trouble: { key: i.mail.key, text: why(e), retry, gone: e instanceof MailError && e.trouble === "gone", reply: send ? kept : undefined } });
      return toast(send ? `Didn't send to ${i.mail.name}. Your reply is kept.` : `Couldn't put ${i.mail.name} away in Gmail.`, again(retry));
    }
    // A reply sent, or a task made: only Gmail's part is left to try again.
    const retry = (): void => void (send ? sendAgain(i, kept) : putAway(i)).catch(() => toast(`Couldn't put ${i.mail.name} away in Gmail.`, again(retry)));
    toast(send ? `Didn't send to ${i.mail.name}. Your reply is kept.` : `Couldn't put ${i.mail.name} away in Gmail.`, again(retry));
  });
}

export async function doDone(i: Item) {
  const d = await done(i);
  said(`Done: ${i.mail.name}`, d, i.mail.key);
  behind(i, d, "done");
}
// A kept mail with a date ahead says when it is due, so Later never hides it.
export async function doLater(i: Item) {
  const due = i.lines?.due, n = due ? daysTo(due, Date.now()) : -1;
  const words = n < 0 ? `Kept for later: ${i.mail.name}` : `Kept: ${first(i.mail.name)} · due ${n === 0 ? "today" : n === 1 ? "tomorrow" : shortDay(due!)}`;
  said(words, await later(i), i.mail.key);
  ++decided;
}
export async function doReply(i: Item, text: string) {
  const d = await reply(i, text);
  said(`Sent to ${first(i.mail.name)}`, d, i.mail.key);
  behind(i, d, "reply", text);
}
export async function doTask(i: Item, o: { title: string; due?: string; reply?: string }) {
  const d = await makeTask(i, o);
  said(o.reply ? `Task made, and ${first(i.mail.name)} told` : "Task made", d, i.mail.key, () => openPage(d.id));
  behind(i, d, "task", o.reply);
}
export async function doKeep(i: Item) {
  said(`Kept: ${i.mail.name}. It will be in your next look.`, await keep(i));
}
export async function doClear() {
  const d = await clearRest();
  said(`${d.cleared} cleared`, d);
  d.settled.catch((e) => toast(why(e)));
}
// Runs a choice; anything it throws before Gmail is asked shows as a toast.
export const run = (p: Promise<unknown>) => void p.catch((e) => toast(why(e)));

// A task's From mail: back in Mail while it waits there, else in Gmail.
export function openMail(ref: MailRef) {
  const key = mailKey(ref.account, ref.id), m = mail.get();
  if (m.look.some((i) => i.mail.key === key)) openLook(key);
  else if (m.waiting.some((i) => i.mail.key === key)) openPage(MAIL_VIEW);
  else run(openExternal(gmailLink(ref)));
}
