import { expect, test, type Page } from "@playwright/test";

// The native command seam: a temporary APNs delay must not delete registration or delivery receipts.
async function controller(page: Page, status: { authorization: string; token?: string; environment?: string; error?: string }) {
  await page.route("**/__notification-controller", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Notification controller</title>" }));
  await page.addInitScript((status) => {
    localStorage.setItem("leadinglight.agent-notifications", "on");
    const callbacks = new Map<number, (event: unknown) => void>(), listeners = new Map<string, number>();
    let next = 1;
    const state = { status, registered: true, receipts: ["already-delivered"], actions: [] as { action: string; expectedConnection: string }[] };
    Reflect.set(window, "notificationFixture", { state, registrationEvent: () => callbacks.get(listeners.get("leadinglight:mobile-notification-registration")!)?.({ payload: null }) });
    Reflect.set(window, "__TAURI_INTERNALS__", {
      transformCallback(callback: (event: unknown) => void) { const id = next++; callbacks.set(id, callback); return id; },
      async invoke(command: string, args: Record<string, any> = {}) {
        if (command === "plugin:app|identifier") return "com.leadinglight.app";
        if (command === "native_platform") return "ios";
        if (command === "plugin:event|listen") { listeners.set(args.event, args.handler); return next++; }
        if (command === "mobile_notifications_take_pending") return null;
        if (command === "mobile_agents_cleanup_notifications") return { pending: 0, error: null };
        if (command === "mobile_agents_status") return { connection: { id: "mac-notifications", name: "Studio Mac", url: "https://relay.test" }, online: true };
        if (["mobile_notifications_status", "mobile_notifications_request"].includes(command)) return state.status;
        if (command === "mobile_agents_notifications") {
          state.actions.push(args as typeof state.actions[number]);
          if (args.action === "register") state.registered = true;
          else if (args.action === "unregister") { state.registered = false; state.receipts = []; }
          else if (args.action !== "status") throw new Error(`Unexpected notification action: ${args.action}`);
          return { registered: state.registered };
        }
        throw new Error(`Unexpected native command: ${command}`);
      },
    });
  }, status);
  await page.goto("/__notification-controller");
  await page.evaluate(async () => {
    const agentsPath = "/src/lib/mobile-agents.ts", notificationsPath = "/src/lib/mobile-notifications.ts";
    await (await import(/* @vite-ignore */ agentsPath)).refreshMobileAgents();
    const notifications = await import(/* @vite-ignore */ notificationsPath);
    Reflect.set(window, "notificationController", notifications);
    await notifications.initMobileNotifications();
  });
}

const snapshot = (page: Page) => page.evaluate(() => {
  const state = Reflect.get(window, "notificationFixture").state;
  return { ...state, controller: Reflect.get(window, "notificationController").mobileNotifications.get() };
});

test("cold-start APNs token delay preserves registration until the registration event", async ({ page }) => {
  await controller(page, { authorization: "authorized" });
  let state = await snapshot(page);
  expect(state.actions.map((a: { action: string }) => a.action)).toEqual(["status"]);
  expect(state.registered).toBe(true);
  expect(state.receipts).toEqual(["already-delivered"]);
  expect(state.controller.error).toContain("Waiting for Apple");
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "notificationFixture");
    fixture.state.status = { authorization: "authorized", token: "a".repeat(64), environment: "production" };
    fixture.registrationEvent();
  });
  await expect.poll(async () => (await snapshot(page)).actions.length).toBe(2);
  state = await snapshot(page);
  expect(state.actions.map((a: { action: string }) => a.action)).toEqual(["status", "register"]);
  expect(state.actions.every((a: { expectedConnection: string }) => a.expectedConnection === "mac-notifications")).toBe(true);
  expect(state.receipts).toEqual(["already-delivered"]);
  await expect.poll(async () => (await snapshot(page)).controller.error).toBe("");
  expect((await snapshot(page)).controller.registered).toBe(true);
});

test("transient APNs registration error reads status without deleting prior delivery receipts", async ({ page }) => {
  await controller(page, { authorization: "authorized", token: "a".repeat(64), environment: "production", error: "APNs temporarily unavailable" });
  let state = await snapshot(page);
  expect(state.actions.map((a: { action: string }) => a.action)).toEqual(["status"]);
  expect(state.controller.error).toBe("APNs temporarily unavailable");
  expect(state.registered).toBe(true);
  expect(state.receipts).toEqual(["already-delivered"]);
  await page.evaluate(async () => {
    delete Reflect.get(window, "notificationFixture").state.status.error;
    await Reflect.get(window, "notificationController").refreshMobileNotifications();
  });
  state = await snapshot(page);
  expect(state.actions.map((a: { action: string }) => a.action)).toEqual(["status", "register"]);
  expect(state.controller.error).toBe("");
  expect(state.receipts).toEqual(["already-delivered"]);
});

for (const reason of ["disable", "denied"]) test(`${reason} unregisters notifications and clears the old delivery receipts`, async ({ page }) => {
  await controller(page, { authorization: reason === "denied" ? "denied" : "authorized" });
  if (reason === "disable") await page.evaluate(() => Reflect.get(window, "notificationController").setMobileNotifications(false));
  const state = await snapshot(page);
  expect(state.actions.at(-1)).toMatchObject({ action: "unregister", expectedConnection: "mac-notifications" });
  expect(state.registered).toBe(false);
  expect(state.receipts).toEqual([]);
  expect(state.controller.registered).toBe(false);
  if (reason === "denied") expect(state.controller.error).toContain("off in iOS Settings");
  else expect(state.controller.enabled).toBe(false);
});
