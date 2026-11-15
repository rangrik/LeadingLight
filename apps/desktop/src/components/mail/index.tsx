// Mail (docs/MAIL.md): home at MAIL_VIEW; the look at MAIL_LOOK shows one mail at a
// time, then the rest, then the end, so the pane's Back leads where he came from.
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Separator } from "@leadinglight/ui/components/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { endLook, mail, startLook, useMail } from "~/lib/mail";
import { MAIL_LOOK } from "~/lib/space";
import { look, lookOpen, place, run } from "./act";
import { openAccounts } from "./accounts";
import { Home } from "./home";
import { MailCard } from "./look";
import { EndView, RestView } from "./rest";

export { MailRoot } from "./accounts";
export { MailRow } from "./today-row";

const demo = import.meta.env.DEV && new URLSearchParams(location.search).get("mail") === "demo";

// What the look shows: the mail at the place, the rest once every mail is decided, then the end.
function stage(m: ReturnType<typeof mail.get>, restOff: string, rest = false) {
  if (rest && m.rest.length) return "rest";
  if (m.look.length) return "mail";
  return !m.waiting.length && m.rest.length && restOff !== m.today.day ? "rest" : "end";
}
// A decided mail leaves the look; the one after it takes its place.
let last = 0;
function current(m: ReturnType<typeof mail.get>, key: string) {
  const at = m.look.findIndex((i) => i.mail.key === key);
  if (at >= 0) last = at;
  return m.look[Math.min(last, m.look.length - 1)];
}
// Stops at the first and last mail; it never wraps round.
const stepFrom = (key: string, by: number) => {
  const m = mail.get(), at = m.look.indexOf(current(m, key)), to = Math.min(m.look.length - 1, Math.max(0, at + by));
  if (to !== at) look.set({ ...look.get(), key: m.look[to].mail.key, trouble: undefined });
};

export function MailView({ view, pane }: { view: string; pane: string }) {
  const m = useMail();
  return (
    // A workspace's mail never shows in another: a new owner starts the view over.
    <div className="w-full max-w-[760px] px-16 pb-12 @max-xl:px-6" data-testid="mail-view" key={m.owner ?? ""}>
      {view === MAIL_LOOK ? <Look pane={pane} /> : <Home demo={demo} pane={pane} view={view} />}
    </div>
  );
}

function Look({ pane }: { pane: string }) {
  const m = useMail();
  const { key, trouble, restOff, rest } = look.use();
  const s = stage(m, restOff, rest);
  const item = s === "mail" ? current(m, key) : undefined;
  useEffect(() => {
    lookOpen.now = true;
    return () => void (lookOpen.now = false);
  }, []);
  // The set is fixed when he starts; reaching the end closes the look for the day.
  useEffect(() => {
    if (s === "mail" && !m.today.set.length && !rest) run(startLook());
    if (s === "end" && !m.today.closed && m.today.started) run(endLook());
  }, [s]);
  if (item) return <MailCard item={item} key={item.mail.key} pane={pane} step={(by) => stepFrom(item.mail.key, by)} trouble={trouble?.key === item.mail.key ? trouble : undefined} view={MAIL_LOOK} />;
  return s === "rest" ? <RestView pane={pane} view={MAIL_LOOK} /> : <EndView pane={pane} view={MAIL_LOOK} />;
}

// The header's counts slot: "2 of 4" or "The rest".
export function MailCount({ view }: { view: string }) {
  const m = useMail();
  const { key, restOff, rest } = look.use();
  if (view !== MAIL_LOOK) return null;
  const s = stage(m, restOff, rest);
  const item = s === "mail" ? current(m, key) : undefined;
  const words = item ? place(item.mail.key) : s === "rest" ? "The rest" : "";
  return (
    words && (
      // Centred, not on the crumbs' baseline: with an icon and no parent crumb, that baseline is the icon's foot.
      <span className="-my-1 flex min-w-0 flex-1 basis-0 items-center self-center overflow-hidden">
        <Separator className="mx-3 h-4 shrink-0 -translate-y-px self-center" orientation="vertical" />
        <span className="flex h-6 shrink-0 items-center text-muted-foreground text-xs tabular-nums">
          <span className="flex h-6 items-center whitespace-nowrap">{words}</span>
        </span>
      </span>
    )
  );
}

// At the header's end: the look's ghost chevrons, or home's accounts button.
export function MailActions({ view, className }: { view: string; className?: string }) {
  const m = useMail();
  const { key, restOff, rest } = look.use();
  if (view !== MAIL_LOOK)
    return (
      m.accounts.length > 0 && (
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="Mail accounts" className={className} onClick={openAccounts} size="icon-xs" variant="ghost" />}>
            <Users className="size-4" />
          </TooltipTrigger>
          <TooltipPopup>Mail accounts</TooltipPopup>
        </Tooltip>
      )
    );
  if (stage(m, restOff, rest) !== "mail" || m.look.length < 2) return null;
  const go = (by: number) => stepFrom(key, by), at = m.look.indexOf(current(m, key));
  return (
    <span className={cn("flex", className)}>
      <Button aria-label="Previous mail" disabled={at <= 0} onClick={() => go(-1)} size="icon-sm" variant="ghost">
        <ChevronUp className="size-4" />
      </Button>
      <Button aria-label="Next mail" disabled={at >= m.look.length - 1} onClick={() => go(1)} size="icon-sm" variant="ghost">
        <ChevronDown className="size-4" />
      </Button>
    </span>
  );
}
