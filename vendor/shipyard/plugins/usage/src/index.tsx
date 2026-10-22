import { definePlugin, useBoxes, useCurrentWorktree, useLocations, useStorage, type BerthPluginContext, type Location, type ScreenProps, type Session } from "@berth/plugin";
import { Alert, AlertDescription, BoxFilter, Button, Icon, PickOne, Tooltip, TooltipPopup, TooltipTrigger, ViewHeader } from "@berth/plugin/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { AccountsView, type Choices } from "./accounts-view";
import { ACCOUNT_VAR, runScript, where, type Account, type Accounts, type Report } from "./box";
import type { Period, Source } from "./data";
import { UsageWidget } from "./home";
import { BoxStatus, UsageView, type BoxState } from "./usage-view";

// Usage & accounts: how many tokens Claude Code and Codex used on each box,
// read from the transcripts they write there, and which login each one uses
// for new sessions. Off until turned on in Settings → Plugins.

export default definePlugin((berth) => {
  berth.addScreen({ id: "usage", title: "Usage", Component: UsageScreen });
  berth.addSidebarItem({ id: "usage", title: "Usage", icon: "ChartColumn", screen: "usage" });
  berth.addHomeWidget({
    id: "usage",
    title: "Agent usage",
    description: "Tokens today and this week, Claude Code's cost estimate, and plan limits.",
    icon: "Gauge",
    category: "Fleet",
    sizes: ["m", "s", "l", "t"],
    source: "usage.py on each box (the agents' own records), every 5 minutes while on screen",
    Component: UsageWidget,
  });
  berth.addCommand({ id: "usage", title: "Show agent usage", group: "Agents", run: () => berth.openScreen("usage") });
  berth.addCommand({
    id: "accounts",
    title: "Switch agent account",
    group: "Agents",
    run: () => {
      berth.storage.set("tab", "accounts");
      berth.openScreen("usage");
    },
  });
});

// Reports are kept per box between launches, so the screen opens on the
// last ones while fresh ones are read.
const reports = new Map<string, Report>();

const EMPTY: BoxData = { locations: [], sessions: [], loading: false };

interface BoxData {
  report?: Report;
  accounts?: Account[];
  locations: Location[];
  sessions: Session[];
  loading: boolean;
  error?: string;
}

function UsageScreen({ berth }: ScreenProps) {
  const paired = useBoxes();
  const online = paired.filter((b) => b.state === "online").map((b) => b.name);
  const allBoxes = paired.map((b) => b.name);
  const current = useCurrentWorktree();
  const [tab, setTab] = useStorage<"usage" | "accounts">("tab", "usage");
  const [period, setPeriod] = useStorage<Period>("period", 7);
  // Usage covers every box but those turned off; accounts are always one box's.
  const [hiddenBoxes, setHiddenBoxes] = useStorage<string[]>("hiddenBoxes", []);
  const covered = allBoxes.filter((b) => !hiddenBoxes.includes(b)).length ? allBoxes.filter((b) => !hiddenBoxes.includes(b)) : allBoxes;
  const multi = covered.length > 1;
  const [pickedAccounts, setPickedAccounts] = useStorage<string>("accountsBox", "");
  const accountsBox = online.includes(pickedAccounts) ? pickedAccounts : current && online.includes(current.box) ? current.box : (online[0] ?? "");

  const [data, setData] = useState<Record<string, BoxData>>({});
  const patch = useCallback((box: string, p: Partial<BoxData>) => setData((d) => ({ ...d, [box]: { ...(d[box] ?? EMPTY), ...p } })), []);

  // One read per box at a time.
  const inflight = useRef(new Set<string>());
  const loadBox = useCallback(
    async (box: string) => {
      if (inflight.current.has(box)) return;
      inflight.current.add(box);
      patch(box, { loading: true, error: undefined });
      try {
        const loc = await where(berth, box, current?.box === box ? current.location : undefined);
        const [report, acc, locations, sessions] = await Promise.all([
          runScript<Report>(berth, box, loc, ["report", "30"]),
          runScript<Accounts>(berth, box, loc, ["accounts"], "30s").catch(() => undefined),
          berth.api.locations(box).catch(() => [] as Location[]),
          berth.api.sessions(box).catch(() => [] as Session[]),
        ]);
        reports.set(box, report);
        const saved = berth.storage.get<Record<string, Report>>("reports", {});
        berth.storage.set("reports", { ...saved, [box]: report });
        patch(box, { report, accounts: acc?.accounts, locations, sessions, loading: false });
      } catch (err) {
        patch(box, { loading: false, error: String((err as Error).message ?? err) });
      } finally {
        inflight.current.delete(box);
      }
    },
    [berth, current?.box, current?.location, patch],
  );

  const targets = covered.filter((b) => online.includes(b));
  const targetKey = targets.join(",");
  const loadUsage = useCallback(() => Promise.all(targets.map((b) => loadBox(b))), [targetKey, loadBox]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Start from the last reports while fresh ones are read.
    const saved = berth.storage.get<Record<string, Report>>("reports", {});
    for (const b of targets) if (!data[b]?.report && (reports.get(b) ?? saved[b])) patch(b, { report: reports.get(b) ?? saved[b] });
    void loadUsage();
    // Only when the boxes change; refresh is a button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // A box still reading its transcripts finishes in the background; ask it
  // again shortly so the rest arrives without a click.
  useEffect(() => {
    const slow = targets.filter((b) => data[b]?.report?.partial && !data[b]?.loading);
    if (!slow.length) return;
    const t = setTimeout(() => slow.forEach((b) => void loadBox(b)), 20_000);
    return () => clearTimeout(t);
  }, [data, targetKey, loadBox]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Accounts tab: one box's logins and where each is chosen.
  const [accounts, setAccounts] = useState<Accounts>();
  const [choices, setChoices] = useState<Choices>();
  const [accountsError, setAccountsError] = useState<string>();
  const [accountsLoading, setAccountsLoading] = useState(false);
  const accountsLocations = useLocations(accountsBox) ?? [];
  const loadAccounts = useCallback(async () => {
    if (!accountsBox) return;
    setAccountsLoading(true);
    setAccountsError(undefined);
    try {
      const loc = await where(berth, accountsBox, current?.box === accountsBox ? current.location : undefined);
      const [a, c] = await Promise.all([runScript<Accounts>(berth, accountsBox, loc, ["accounts"], "30s"), readChoices(berth, accountsBox)]);
      setAccounts(a);
      setChoices(c);
    } catch (err) {
      setAccountsError(String((err as Error).message ?? err));
    } finally {
      setAccountsLoading(false);
    }
  }, [berth, accountsBox, current?.box, current?.location]);
  useEffect(() => {
    if (tab !== "accounts") return;
    setAccounts(undefined);
    setChoices(undefined);
    void loadAccounts();
  }, [tab, accountsBox]); // eslint-disable-line react-hooks/exhaustive-deps

  const states: BoxState[] = covered.map((b) => ({ box: b, online: online.includes(b), loading: Boolean(data[b]?.loading), error: data[b]?.error }));
  const sources: Source[] = targets.flatMap((b) => (data[b]?.report ? [{ box: b, report: data[b].report!, locations: data[b].locations }] : []));
  const loading = tab === "usage" ? states.some((s) => s.loading) : accountsLoading;
  const single = !multi ? data[covered[0]] : undefined;

  return (
    <>
      <ViewHeader
        title="Usage & accounts"
        description="Tokens Claude Code and Codex used on your boxes, from the transcripts they keep there, and which account new sessions sign in with."
        actions={
          <>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Refresh" disabled={!online.length} loading={loading} onClick={() => void (tab === "usage" ? loadUsage() : loadAccounts())} />}>
                <Icon name="RefreshCw" />
              </TooltipTrigger>
              <TooltipPopup>Refresh</TooltipPopup>
            </Tooltip>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <PickOne
          label="Show"
          value={tab}
          onChange={(v: string) => setTab(v as "usage" | "accounts")}
          options={[
            { value: "usage", label: "Usage" },
            { value: "accounts", label: "Accounts" },
          ]}
        />
        {tab === "usage" ? (
          <>
            <BoxFilter className="ml-auto" boxes={allBoxes} hidden={hiddenBoxes} onChange={setHiddenBoxes} />
            <PickOne
              label="Period"
              className={allBoxes.length < 2 ? "ml-auto" : undefined}
              value={String(period)}
              onChange={(v: string) => setPeriod(Number(v) as Period)}
              options={[
                { value: "1", label: "Today" },
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
              ]}
            />
          </>
        ) : (
          // Accounts are one box's at a time.
          online.length > 1 && <PickOne label="Box" className="ml-auto" value={accountsBox} onChange={setPickedAccounts} options={online.map((b) => ({ value: b, label: b }))} />
        )}
      </div>

      {tab === "usage" && multi && states.length > 0 && <BoxStatus states={states} files={Object.fromEntries(targets.map((b) => [b, data[b]?.report?.files]))} allBoxes={allBoxes} />}

      {((tab === "usage" && single?.error) || (tab === "accounts" && accountsError)) && (
        <Alert variant="error">
          <Icon name="CircleAlert" />
          <AlertDescription>
            Couldn't read {tab === "usage" ? `usage on ${covered[0]}: ${single?.error}` : `accounts on ${accountsBox}: ${accountsError}`}
          </AlertDescription>
        </Alert>
      )}

      {!online.length ? (
        <p className="py-16 text-center text-muted-foreground text-sm">Connect a box to see its agents' usage.</p>
      ) : tab === "usage" ? (
        !multi && !online.includes(covered[0]) ? (
          <p className="py-16 text-center text-muted-foreground text-sm">{covered[0]} is offline; its usage shows once it's back.</p>
        ) : (
          <UsageView
            berth={berth}
            period={period}
            sources={sources}
            states={states.filter((s) => s.online)}
            accounts={Object.fromEntries(targets.map((b) => [b, data[b]?.accounts]))}
            running={Object.fromEntries(targets.map((b) => [b, data[b]?.sessions]))}
            allBoxes={allBoxes}
            multi={multi}
          />
        )
      ) : (
        <AccountsView berth={berth} box={accountsBox} data={accounts} choices={choices} locations={accountsLocations} reload={loadAccounts} />
      )}
    </>
  );
}

// readChoices reads where accounts are chosen: the box env and every
// project's effective env, keeping only the account variables.
async function readChoices(berth: BerthPluginContext, box: string): Promise<Choices> {
  const pick = (env: Record<string, string> | undefined) => Object.fromEntries(Object.entries(env ?? {}).filter(([k]) => Object.values(ACCOUNT_VAR).includes(k)));
  const [env, locs] = await Promise.all([berth.api.request<{ env: Record<string, string> }>(box, "GET", "env").catch(() => ({ env: {} })), berth.api.locations(box)]);
  const projects: Record<string, Record<string, string>> = {};
  await Promise.all(
    locs.map(async (l) => {
      const c = await berth.api.request<{ effective?: { env?: Record<string, string> } }>(box, "GET", `locations/${encodeURIComponent(l.name)}/config`).catch(() => undefined);
      const e = pick(c?.effective?.env);
      if (Object.keys(e).length) projects[l.name] = e;
    }),
  );
  return { box: pick(env.env), projects };
}
