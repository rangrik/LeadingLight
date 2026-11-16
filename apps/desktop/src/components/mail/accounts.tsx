// Connecting Gmail and the accounts dialog, built like Calendar's "Your calendars". MailRoot is
// mounted once by the app: the reader, the return from Google, and the dialog.
import { useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { connectGmail, gmailApi } from "~/lib/gmail";
import { mail, refresh, setKind, useMail } from "~/lib/mail";
import { LABEL, type Kind } from "~/lib/mail-rules";
import { useMailReader } from "~/lib/mail-reader";
import { createStore } from "~/lib/state";
import { accountReturns, clearAccountReturn } from "~/lib/account-return";
import { focusedPage, panes } from "~/lib/panes";
import { MAIL_VIEW } from "~/lib/space";

// waiting: Google is open in the browser; the page checks by itself until an account appears.
export const connection = createStore({ busy: false, waiting: false, accountCount: 0, notice: "", error: "", dialog: false });
const set = (patch: Partial<ReturnType<typeof connection.get>>) => connection.set({ ...connection.get(), ...patch });
export const openAccounts = () => set({ dialog: true });
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

let watch: ReturnType<typeof setInterval> | undefined;
export async function connectNow() {
  if (connection.get().busy) return;
  set({ busy: true, error: "", notice: "" });
  try {
    await connectGmail();
    const until = Date.now() + 10 * 60_000;
    set({ waiting: true, accountCount: mail.get().accounts.length });
    clearInterval(watch);
    watch = setInterval(() => {
      if (Date.now() > until || !connection.get().waiting) return void (clearInterval(watch), set({ waiting: false }));
      if (document.visibilityState === "visible") void refresh({ full: true });
    }, 4000);
  } catch (e) {
    set({ error: why(e) });
  } finally {
    set({ busy: false });
  }
}

export function MailRoot() {
  useMailReader();
  const { dialog, waiting, accountCount } = connection.use();
  const connected = useMail().accounts.length;
  const returned = accountReturns.use().gmail;
  useEffect(() => {
    let page = focusedPage();
    return panes.subscribe(() => { const next = focusedPage(); if (next !== page && next !== MAIL_VIEW) set({ notice: "" }); page = next; });
  }, []);
  useEffect(() => {
    if (!returned || returned.owner !== mail.get().owner) return;
    clearAccountReturn("gmail", returned.id);
    clearInterval(watch);
    set({ waiting: false, dialog: false, error: "", notice: returned.result === "cancelled" ? "Connection cancelled. Nothing changed." : "" });
    if (returned.result === "connected") void refresh({ full: true });
  }, [returned]);
  useEffect(() => {
    const front = () => void refresh({ full: connection.get().waiting });
    window.addEventListener("leadinglight:app-focus", front);
    return () => window.removeEventListener("leadinglight:app-focus", front);
  }, []);
  useEffect(() => {
    if (waiting && connected > accountCount) { clearInterval(watch); set({ waiting: false }); }
  }, [waiting, connected, accountCount]);
  useEffect(() => {
    const url = new URL(location.href), result = url.searchParams.get("gmail");
    if (!result) return;
    if (result === "cancelled") set({ notice: "Connection cancelled. Nothing changed.", waiting: false });
    else void refresh({ full: true });
    url.searchParams.delete("gmail");
    history.replaceState(null, "", url);
  }, []);
  return <Accounts onOpenChange={(open) => set({ dialog: open })} open={dialog} />;
}

function Accounts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMail();
  const c = connection.use();
  const disconnect = async (account: string) => {
    set({ error: "" });
    try {
      await gmailApi("disconnect", { account });
      await refresh({ full: true });
    } catch (e) {
      set({ error: why(e) });
    }
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mail accounts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-6">
          {c.error && (
            <p className="text-destructive text-sm" role="alert">
              {c.error}
            </p>
          )}
          {m.accounts.map((a) => (
            <section className="space-y-2" key={a.account}>
              <p className="break-all text-sm">
                {a.email}
                {a.out && <span className="text-muted-foreground"> · needs reconnecting</span>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl aria-label={`${a.email} is`} render={<RadioGroupPrimitive onValueChange={(v) => void setKind(a.email, v as Kind)} value={a.kind} />} size="sm">
                  {(["personal", "work"] as const).map((k) => (
                    <SegmentedControlItem key={k} render={<RadioPrimitive.Root value={k} />}>
                      {LABEL[k]}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                {a.out && (
                  <Button disabled={c.busy} onClick={() => void connectNow()} size="sm" variant="outline">
                    Reconnect
                  </Button>
                )}
                <Button aria-label={`Disconnect ${a.email}`} onClick={() => void disconnect(a.account)} size="sm" variant="ghost">
                  Disconnect
                </Button>
              </div>
            </section>
          ))}
          <Button disabled={c.busy || !!m.error} onClick={() => void connectNow()}>
            {c.waiting ? "Open Google again" : "Add account"}
          </Button>
          {c.waiting && <p className="text-muted-foreground text-sm">Finish in the browser window that opened. This page updates by itself.</p>}
          <p className="text-muted-foreground text-xs">Disconnect removes saved access. Your mail stays in Google.</p>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
