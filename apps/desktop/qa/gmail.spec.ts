import { expect, test, type Page } from "@playwright/test";

// Mail against a mocked service (features/gmail.feature). The browser build has no model, so the
// reader's lines are seeded where the app keeps them.
const now = new Date(2026, 10, 14, 15, 2);
const at = (h: number, m: number) => new Date(2026, 10, 14, h, m).getTime();
const key = (account: string, id: string) => JSON.stringify([account, id]);
type Msg = { account: string; id: string; from: string; replyTo?: string; subject: string; date: number; labels?: string[]; unsubscribe?: boolean };
const MAIL: Msg[] = [
  { account: "work", id: "arjun", from: "Arjun Rao <arjun@northlane.io>", subject: "Expense claim approved", date: at(11, 42) },
  { account: "work", id: "meera", from: "Meera Iyer <meera@northlane.io>", replyTo: "Design team <design@northlane.io>", subject: "Re: Design review", date: at(14, 14) },
  { account: "personal", id: "sunita", from: "Sunita Kulkarni <sunita@gmail.com>", subject: "Flat 302 renewal", date: at(9, 5) },
  { account: "work", id: "daniel", from: "Daniel Weiss <daniel@northlane.io>", subject: "Larkfield estimate", date: at(13, 20) },
  { account: "personal", id: "amazon", from: "Amazon <ship@amazon.example>", subject: "Your order has shipped", date: at(8, 0), labels: ["CATEGORY_UPDATES"] },
  { account: "work", id: "news", from: "TLDR <news@tldr.example>", subject: "Friday's top stories", date: at(7, 0), unsubscribe: true },
];
const lines = (verdict: string, headline: string, o: object = {}) => ({ verdict, headline, happened: `${headline}: what happened.`, stands: `${headline}: where it stands.`, part: verdict === "none" ? "Nothing." : "Your part.", upset: false, replies: [], ...o });
const READ = {
  arjun: lines("none", "Your expense claim was approved"),
  meera: lines("quick", "Meera wants to move the review to 4 pm", { replies: [{ label: "4 pm works", text: "Hi Meera,\n\n4 pm works.\n\nPranav" }, { label: "Try Friday", text: "Friday?" }] }),
  sunita: lines("reply", "Sunita asks if you will renew"),
  daniel: lines("work", "Daniel needs a cost estimate", { due: "2026-11-20", task: { title: "Send Daniel the estimate", due: "2026-11-20", ack: "Got it, Daniel." } }),
};

async function service(page: Page, o: { read?: boolean; html?: string; out?: string } = {}) {
  const calls = { modify: [] as any[], send: [] as any[], external: [] as string[], senders: [] as any[] };
  let accounts = [{ account: "personal", email: "pranav.k@gmail.com" }, { account: "work", email: "pranav@northlane.io" }];
  page.on("request", (r) => !new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/) && calls.external.push(r.url()));
  await page.clock.install({ time: now });
  const state = { start: at(0, 0) - 7 * 86_400_000, days: 7, ran: o.read === false ? 0 : at(14, 58), kinds: {}, kept: {}, today: { day: "2026-11-14", set: [], handled: {}, cleared: 0, started: 0, ended: 0, closed: false, left: 0 },
    read: o.read === false ? {} : { ...Object.fromEntries(Object.entries(READ).map(([id, l]) => [key(MAIL.find((m) => m.id === id)!.account, id), { at: at(14, 58), lines: l }])), [key("personal", "amazon")]: { at: at(14, 58), group: "Receipts" }, [key("work", "news")]: { at: at(14, 58), group: "Newsletters" } } };
  await page.addInitScript((s) => localStorage.getItem("leadinglight.mail:mail-owner") || localStorage.setItem("leadinglight.mail:mail-owner", s), JSON.stringify(state));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
    const json = (result: unknown) => route.fulfill({ json: result });
    if (path === "/api/config") return json({ ready: true, allowed: true, providers: [] });
    if (path === "/api/me") return json({ id: "mail-owner", name: "Pranav K" });
    if (path === "/api/auth/csrf") return json({ csrfToken: "t" });
    if (path === "/api/auth/signout") return json({ url: "/" });
    if (path === "/api/gmail/accounts") return json({ accounts });
    if (path === "/api/gmail/counts") return json({ inbox: 10 });
    if (path === "/api/gmail/messages") {
      // A new-sender lookup: Sunita has written once, everyone else before.
      if (body.query) return (calls.senders.push(body), json({ nextPageToken: null, messages: Array(body.query === "from:sunita@gmail.com" ? 1 : 2).fill({}) }));
      if (body.account === o.out) return route.fulfill({ status: 401, json: { error: "Gmail access expired. Reconnect this account." } });
      return json({ nextPageToken: null, messages: MAIL.filter((m) => m.account === body.account).map((m) => ({ ...m, threadId: `t-${m.id}`, to: "", cc: "", replyTo: m.replyTo ?? "", snippet: "Hello", unread: true, labels: ["INBOX", "UNREAD", ...(m.labels ?? [])], unsubscribe: !!m.unsubscribe })) });
    }
    if (path === "/api/gmail/thread") return json({ messages: [{ id: "x", threadId: body.id, from: "Sender <s@example.test>", date: at(9, 0), text: "", html: o.html ?? "<p>Hello there</p>", attachments: [] }] });
    if (path === "/api/gmail/modify") return (calls.modify.push(body), json({}));
    if (path === "/api/gmail/send") return (calls.send.push(body), json({}));
    return json({});
  });
  return { calls, signOut: () => (accounts = []) };
}
const today = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Today", exact: true }).first().click();
};
const row = (page: Page) => page.getByTestId("mail-row");
const toast = (page: Page, text: string) => page.locator("[data-slot=toast-title]", { hasText: text });

// Seam: a fixed service must recover from the native-route error and finish connecting without a reload.
test("retry the service, connect Gmail, and pick up the new account", async ({ page, context }) => {
  let failed = true, connected = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: { ready: true, allowed: true, providers: [] } });
    if (path === "/api/me") return route.fulfill({ json: { id: "mail-owner", name: "Mail test" } });
    if (path === "/api/gmail/accounts") return route.fulfill(failed
      ? { status: 403, json: { error: "This native session cannot use this route." } }
      : { json: { accounts: connected ? [{ account: "personal", email: "mail@example.test" }] : [] } });
    if (path === "/api/gmail/connect") return route.fulfill({ json: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=qa" } });
    return route.fulfill({ json: { inbox: 3 } });
  });
  await context.route("https://accounts.google.com/**", (route) => route.fulfill({ body: "Google consent fixture" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Mail", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("This native session cannot use this route.");
  await expect(page.getByRole("button", { name: "Connect Gmail" })).toBeDisabled();
  failed = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Gmail" }).click();
  const popup = await opened;
  await expect(popup).toHaveURL(/accounts\.google\.com/);
  await expect(page.getByText("Finish in the browser window that opened. This page updates by itself.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Google again" })).toBeEnabled();
  connected = true;
  await popup.close();
  await expect(page.getByRole("heading", { name: "Start fresh" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Add another account" })).toBeVisible({ timeout: 1000 });
  await expect(page.getByText("mail@example.test · 3 waiting")).toBeVisible();
});

// Seam: the whole look against the service. Catches a choice that does not reach Gmail, a reply
// sent before its 8 seconds or after Undo, a task that copies the mail's own text, a reply form
// naming another address than the one the service sends to, and a costly new-sender lookup.
test("one look, from Today to Mail done", async ({ page }) => {
  const { calls } = await service(page);
  await today(page);
  await expect(row(page)).toContainText("4 need you · about 5 min · nothing due before Fri");
  await row(page).getByRole("button", { name: "Go through" }).click();
  await expect(page.getByRole("heading", { name: "Your expense claim was approved" })).toBeVisible();
  await expect(page.getByTestId("mail-who")).toContainText("arjun@northlane.io");
  await page.keyboard.press("Enter");
  await expect(toast(page, "Done: Arjun Rao")).toBeVisible();
  await expect.poll(() => calls.modify).toEqual([{ account: "work", id: "t-arjun", add: [], remove: ["INBOX", "UNREAD"] }]);

  await expect(page.getByRole("heading", { name: "Meera wants to move the review to 4 pm" })).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveValue("Hi Meera,\n\n4 pm works.\n\nPranav");
  await expect(page.getByText("To design@northlane.io · from pranav@northlane.io")).toBeVisible();
  await page.keyboard.press("Meta+Enter");
  await expect(toast(page, "Sent to Meera")).toBeVisible();
  await page.clock.runFor(4000);
  await page.keyboard.press("z");
  await expect(page.getByRole("heading", { name: "Meera wants to move the review to 4 pm" })).toBeVisible();
  await page.clock.runFor(9000);
  expect(calls.send).toEqual([]);
  await page.keyboard.press("r");
  await page.keyboard.press("Meta+Enter");
  await page.clock.runFor(8100);
  await expect.poll(() => calls.send).toEqual([{ account: "work", id: "meera", text: "Hi Meera,\n\n4 pm works.\n\nPranav" }]);

  await expect(page.getByRole("heading", { name: "Sunita asks if you will renew" })).toBeVisible();
  await expect(page.getByTestId("mail-tags")).toContainText("New sender");
  expect(calls.senders).toContainEqual({ account: "personal", query: "from:sunita@gmail.com", max: 2 });
  await page.keyboard.press("l");
  await expect(toast(page, "Kept for later: Sunita Kulkarni")).toBeVisible();
  await expect(page.getByTestId("mail-tags")).toContainText("By Fri, Nov 20 · 6 days left");
  await page.keyboard.press("t");
  await expect(page.getByRole("textbox", { name: "Task" })).toHaveValue("Send Daniel the estimate");
  await page.keyboard.press("Enter");
  await expect(toast(page, "Task made")).toBeVisible();
  await toast(page, "Task made").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: "Daniel Weiss · Work · Larkfield estimate" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page body" }).locator("p")).toHaveText(["Daniel needs a cost estimate: what happened.", "Daniel needs a cost estimate: where it stands."]);
  await page.keyboard.press("Meta+[");

  await expect(page.getByRole("heading", { name: "2 others, nothing to do" })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByText("That's everything")).toBeVisible();
  await expect(page.getByText(/Nothing left is due before Fri, Nov 20\.$/)).toBeVisible();
  await expect.poll(() => calls.modify.map((m) => m.id).sort()).toEqual(["t-amazon", "t-arjun", "t-daniel", "t-meera", "t-news"]);
  await page.keyboard.press("Enter");
  await expect(row(page)).toContainText(/^Mail done · 1 replied, 1 task, 1 done, 1 kept for later, 2 cleared · \d+ min$/);
});

// Seam: mail and the reader's lines are written by strangers. Catches markup rendered as HTML,
// a script that runs, and an image fetched from another host.
test("mail and lines with markup show as text", async ({ page }) => {
  READ.arjun.headline = "<img src=https://tracking.example/a onerror=window.pwned=1>";
  const { calls } = await service(page, { html: `<p>Hi <b>there</b></p><img src="https://tracking.example/pixel"><script>window.pwned=2</script>` });
  READ.arjun.headline = "Your expense claim was approved";
  await today(page);
  await row(page).getByRole("button", { name: "Go through" }).click();
  await expect(page.getByRole("heading", { name: "<img src=https://tracking.example/a onerror=window.pwned=1>" })).toBeVisible();
  await expect(page.getByTestId("mail-body")).toHaveText("Hi there");
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  expect(calls.external).toEqual([]);
});

// Seam: a workspace's mail never shows in another. Catches a late listing that lands after sign-out.
test("signing out removes mail, and a late answer cannot bring it back", async ({ page }) => {
  const s = await service(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await today(page);
  await expect(row(page)).toContainText("4 need you");
  await page.route("**/api/gmail/messages", async (route) => (await held, route.fallback()));
  const asked = page.waitForRequest("**/api/gmail/messages");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await asked;
  s.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event("leadinglight:cloud-account")));
  // Sign out asks first; the question's own button is the one that signs out.
  await page.getByTestId("settings-account").getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(row(page)).toHaveCount(0);
  release();
  await page.clock.runFor(2000);
  await expect(row(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mail", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Sign in to connect Gmail" })).toBeVisible();
  await expect(page.getByText("Meera wants")).toHaveCount(0);
});

// Seam: one account's failure must not hide the other's mail.
test("one account signed out: reconnect row, and the other still works", async ({ page }) => {
  await service(page, { out: "work" });
  await today(page);
  await expect(row(page)).toContainText("1 needs you");
  await expect(row(page)).toContainText("Work mail needs reconnecting");
  await expect(row(page).getByRole("button", { name: "Reconnect" })).toBeVisible();
  await row(page).getByRole("button", { name: "Go through" }).click();
  await expect(page.getByRole("heading", { name: "Sunita asks if you will renew" })).toBeVisible();
});

// Seam: without the reader, mail still shows and nothing is chosen for him.
test("the reader cannot run: not read for you, Enter does nothing", async ({ page }) => {
  const { calls } = await service(page, { read: false });
  await today(page);
  await expect(row(page)).toContainText("4 new from people · not read for you yet");
  await row(page).getByRole("button", { name: "Go through" }).click();
  await expect(page.getByText("Not read for you")).toBeVisible();
  const choices = ["Reply", "Done", "Make a task", "Later"].map((name) => page.getByRole("button", { name: new RegExp(`^${name}`) }));
  for (const c of choices) await expect(c).toHaveClass(/border-input/);
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  await page.keyboard.press("Enter");
  await page.clock.runFor(500);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  expect(calls.modify).toEqual([]);
});

// Seam: the rest's Look must open the rest while mails still wait, and J must not wrap to the first mail.
test("Look opens the rest, and J stops at the last mail", async ({ page }) => {
  await service(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Mail", exact: true }).first().click();
  await page.getByRole("button", { name: "Look", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 others, nothing to do" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Go through/ }).click();
  for (let i = 0; i < 5; i++) await page.keyboard.press("j");
  await expect(page.getByText("4 of 4")).toBeVisible();
});
