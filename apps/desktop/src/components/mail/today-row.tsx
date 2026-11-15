import { Check, CircleAlert, Mail } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Row } from "~/components/work-panel";
import { useMail } from "~/lib/mail";
import { runReader } from "~/lib/mail-reader";
import { openPage } from "~/lib/panes";
import { MAIL_VIEW } from "~/lib/space";
import { doClear, goThrough, openLook, run } from "./act";
import { openAccounts } from "./accounts";

// Today's row (design 5.1), in a box like the daily card's: what mail will cost, and the one door in.
export function MailRow() {
  const m = useMail();
  useEffect(() => void runReader(), []);
  const s = m.said;
  const button = (label: string, onClick: () => void, variant: "outline" | "ghost" = "outline") => (
    <Button key={label} onClick={onClick} size="xs" variant={variant}>
      {label}
    </Button>
  );
  const buttons =
    s.state === "first" ? [button("Start fresh", () => openPage(MAIL_VIEW))]
    : s.state === "started" ? [button("Continue", () => openLook())]
    : s.state === "rest" ? [button("Clear all", () => !m.offline && run(doClear())), button("Look", () => openLook("", true), "ghost")]
    : ["needs", "away", "unread", "due"].includes(s.state) ? [button("Go through", () => goThrough(s.state))]
    : [];
  const done = s.state === "done" || s.state === "paused";
  const main = s.state !== "none" && (s.lead || s.rest);
  if (!main && !s.signedOut.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm" data-testid="mail-row">
      {main && (
        <Row>
          {done ? <Check className="size-4 shrink-0 text-muted-foreground" /> : <Mail className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-auto truncate text-muted-foreground">
            {s.lead && <span className={done ? "" : "font-medium text-foreground"}>{s.lead}</span>}
            {s.lead && s.rest && " · "}
            {s.rest}
          </span>
          {buttons.length > 0 && <span className="ms-auto flex flex-wrap justify-end gap-1">{buttons}</span>}
        </Row>
      )}
      {s.signedOut.map((words) => (
        <Row key={words}>
          <CircleAlert className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-auto truncate text-muted-foreground">{words}</span>
          <span className="ms-auto flex">{button("Reconnect", openAccounts)}</span>
        </Row>
      ))}
    </div>
  );
}
