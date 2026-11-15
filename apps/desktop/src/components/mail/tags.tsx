// Mail's tags (design 5.0): COSS Badges, always in this order: kind, date, account, new sender.
import { Clock } from "lucide-react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { cn } from "@leadinglight/ui/lib/utils";
import { useMail } from "~/lib/mail";
import { type Item, LABEL, minutesOf, VERDICT, when } from "~/lib/mail-rules";
import { type Color, COLORS } from "~/lib/page-meta";

// An account's dot follows its place in the list, so it never changes between screens.
const DOTS: Color[] = ["blue", "purple", "teal", "orange"];

export function AccountTag({ account, size, tip }: { account: string; size?: "lg"; tip?: boolean }) {
  const { accounts } = useMail();
  const at = accounts.findIndex((a) => a.account === account), a = accounts[at];
  if (!a) return null;
  const inner = (
    <>
      <span className={cn("size-1.5 rounded-full", COLORS[DOTS[at % DOTS.length]].dot)} />
      {LABEL[a.kind]}
    </>
  );
  if (!tip)
    return (
      <Badge size={size} variant="outline">
        {inner}
      </Badge>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge size={size} variant="outline" />}>{inner}</TooltipTrigger>
      <TooltipPopup>Sent to {a.email}</TooltipPopup>
    </Tooltip>
  );
}

// On the mail: the kind, the date, the account and, for a first mail, New sender.
export function Tags({ item, now }: { item: Item; now: number }) {
  const l = item.lines, w = when(l, now), mins = minutesOf(item);
  return (
    <div className="flex flex-wrap gap-1.5 pt-10" data-testid="mail-tags">
      {l ? (
        <Badge size="lg" variant={l.verdict === "none" ? "success" : "secondary"}>
          {l.verdict === "none" || l.verdict === "work" ? VERDICT[l.verdict] : `${VERDICT[l.verdict]} · ${mins} min`}
        </Badge>
      ) : (
        <Badge className="text-muted-foreground" size="lg" variant="outline">
          Not read for you
        </Badge>
      )}
      {w && (
        <Badge className={cn(w.tone === "quiet" && "text-muted-foreground")} size="lg" variant={w.tone === "soon" ? "warning" : "outline"}>
          <Clock className="size-3" />
          {/* One span, so the badge's gap does not split the words. Narrow panes drop "By" and "left". */}
          <span>
            {w.days ? (
              <>
                <span className="@max-[34rem]:hidden">By </span>
                {w.day} · {w.days} days<span className="@max-[34rem]:hidden"> left</span>
              </>
            ) : (
              w.text
            )}
          </span>
        </Badge>
      )}
      <AccountTag account={item.mail.account} size="lg" tip />
      {item.fresh && (
        <Badge size="lg" variant="outline">
          New sender
        </Badge>
      )}
    </div>
  );
}

// In a list row: Today and Tomorrow as amber tags, a later date with its days, else plain words.
// The amber tag's -me-1 lines its text up with the plain dates; size-3 beats the row button's icon size.
export function WhenCell({ item, now }: { item: Item; now: number }) {
  const w = when(item.lines, now);
  if (!w) return null;
  if (w.tone === "soon")
    return (
      <Badge className="-me-1" variant="warning">
        <Clock className="size-3" />
        {w.text}
      </Badge>
    );
  if (!w.days) return <span>{w.text}</span>;
  return (
    <span>
      {w.day} · <span className="font-medium text-foreground">{w.days} days</span>
    </span>
  );
}
