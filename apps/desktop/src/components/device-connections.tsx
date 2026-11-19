import { useEffect, useMemo, useState } from 'react';
import { Button } from '@leadinglight/ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@leadinglight/ui/components/dialog';
import { SettingsGroup, SettingsRow } from '@/views/settings/rows';
import { Monitor, FileCheck2 } from 'lucide-react';
import { useCloud } from '~/lib/cloud';
import {
  activeProjectLink,
  approveLink,
  beginLink,
  connectionPicker,
  deviceLinks,
  endLink,
  pollDevices,
  resetDevices,
  selectLink,
  type Link,
} from '~/lib/device-links';
import { choices, matchKeys } from '~/lib/device-match';
import { isNative, platform } from '~/lib/platform';
import { folders, locationOf } from '~/lib/project-runtime/folders';
import { mobileAgents, mobileCall, refreshMobileAgents } from '~/lib/mobile-agents';
import { shareProjectReviews, type HostReview } from '~/lib/project-reviews';
import { pageOf } from '~/lib/space';

export function DeviceConnections() {
  const cloud = useCloud(),
    os = platform.use(),
    s = deviceLinks.use(),
    pick = connectionPicker.use();
  const [time, setTime] = useState(Date.now),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [allowed, setAllowed] = useState(import.meta.env.DEV);
  useEffect(() => {
    void isNative.then((native) => setAllowed(native || import.meta.env.DEV));
  }, []);
  useEffect(() => {
    resetDevices(cloud.user?.id ?? '');
    if (!allowed || !cloud.user || !cloud.config.allowed) return;
    const tick = () => {
      void pollDevices();
    };
    tick();
    const interval = setInterval(tick, 4000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [cloud.user?.id, cloud.config.allowed, allowed]);
  useEffect(() => (os === 'macos' ? shareProjectReviews() : undefined), [os]);
  const ours = s.owner === cloud.user?.id;
  const pending = ours ? s.links.filter((l) => l.state === 'pending' && Date.parse(l.expiresAt) > time) : [];
  const link = pending.find((l) => l.target === s.session) ?? pending.find((l) => l.requester === s.session);
  const id = link?.id;
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => setTime(Date.now()), 500);
    return () => clearInterval(timer);
  }, [id]);
  const [match, setMatch] = useState<{ id: string; n: number; options: number[] }>();
  useEffect(() => {
    setError('');
    setMatch(undefined);
    if (!link || !ours) return;
    let valid = true;
    void matchKeys(s.owner, s.session, link).then(
      (k) => {
        if (valid) setMatch({ id: link.id, n: k.number, options: choices(k.number) });
      },
      (e) => {
        if (valid) setError(String(e));
      },
    );
    return () => {
      valid = false;
    };
  }, [id, s.session, s.owner, ours]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTime(Date.now());
    }
  };
  const incoming = link?.target === s.session;
  const projectLabel = (p: string) => pageOf(p)?.title || 'this project';
  if (!allowed || !cloud.user) return null;
  return (
    <Dialog
      open={!!link || !!pick}
      onOpenChange={(open) => {
        if (!open && !link) {
          connectionPicker.set(null);
          setError('');
        }
      }}
    >
      <DialogPopup showCloseButton={!link} className="max-w-sm">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>{incoming ? link.requesterName + ' wants to connect' : 'Look at ' + link.targetName}</DialogTitle>
              <DialogDescription>
                {incoming
                  ? 'Tap the number shown on ' + link.requesterName + '.'
                  : 'Open LeadingLight there and tap this number.'}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              {incoming && (
                <p className="text-sm">
                  {link.project
                    ? 'Allow this device to ' +
                      (link.notes ? 'read and change your notes and ' : '') +
                      'run agents in ' +
                      projectLabel(link.project) +
                      ' on this Mac.'
                    : 'Allow this device to read and change your notes.'}
                </p>
              )}
              {match?.id === id &&
                match &&
                (incoming ? (
                  <div className="flex gap-2">
                    {match.options.map((n) => (
                      <Button
                        className="min-h-12 flex-1 tabular-nums"
                        disabled={busy}
                        key={n}
                        onClick={() => void run(() => approveLink(link, n))}
                        variant="outline"
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-5xl font-semibold tabular-nums">{match.n}</p>
                ))}
              <p className="text-center text-xs text-muted-foreground">
                Expires in {Math.max(0, Math.ceil((Date.parse(link.expiresAt) - time) / 1000))} seconds
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => void run(() => endLink(link.id, incoming ? 'deny' : 'cancel'))}
                variant="outline"
              >
                {incoming ? 'Deny' : 'Cancel'}
              </Button>
            </DialogFooter>
          </>
        ) : pick ? (
          <>
            <DialogHeader>
              <DialogTitle>{pick.project ? 'Connect to a project Mac' : 'Set up note sync'}</DialogTitle>
              <DialogDescription>
                {pick.project ? 'Choose the Mac with the project folder.' : 'Choose a device that already has your notes.'}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <SettingsGroup>
                {s.devices.map((d) => {
                  const reason = !d.online
                    ? 'Open LeadingLight on this device'
                    : !d.sync && !pick.project
                      ? 'Set up note sync there first'
                      : pick.project && !d.projects.includes(pick.project)
                        ? 'Project folder unavailable here'
                        : '';
                  return (
                    <SettingsRow key={d.id} label={d.name} description={reason || 'Available'}>
                      <Button
                        size="sm"
                        disabled={busy || !!reason}
                        onClick={() => void run(() => beginLink(d.id, pick.project))}
                        variant="outline"
                      >
                        Request
                      </Button>
                    </SettingsRow>
                  );
                })}
              </SettingsGroup>
              {!s.devices.length && (
                <p className="text-sm text-muted-foreground">Open LeadingLight on another signed-in device.</p>
              )}
            </DialogPanel>
          </>
        ) : null}
        {(error || s.error) && (
          <p role="alert" className="px-6 pb-3 text-sm text-destructive-foreground">
            {error || s.error}
          </p>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export function DeviceConnectionSettings() {
  const s = deviceLinks.use(),
    cloud = useCloud();
  const [remove, setRemove] = useState<Link>(),
    [error, setError] = useState('');
  if (!cloud.user || s.owner !== cloud.user.id || !s.session) return null;
  const links = s.links.filter((l) => l.state === 'approved');
  return (
    <SettingsGroup
      title="Device connections"
      actions={
        <Button variant="outline" size="sm" onClick={() => connectionPicker.set({ project: null })}>
          Connect a device
        </Button>
      }
    >
      {links.map((l) => (
        <SettingsRow
          key={l.id}
          label={l.requester === s.session ? l.targetName : l.requesterName}
          description={
            l.project ? (l.notes ? 'Notes and ' : '') + (pageOf(l.project)?.title || 'project work') : 'Notes only'
          }
        >
          <Button size="sm" variant="outline" onClick={() => setRemove(l)}>
            Remove
          </Button>
        </SettingsRow>
      ))}
      {!links.length && (
        <p className="py-3 text-sm text-muted-foreground">Approve a device once to use it away from home.</p>
      )}
      <Dialog
        open={!!remove}
        onOpenChange={(v) => {
          if (!v) setRemove(undefined);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Remove this connection?</DialogTitle>
            <DialogDescription>
              Future access through this connection ends. Notes already on either device stay there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (remove)
                  void endLink(remove.id, 'remove').then(
                    () => setRemove(undefined),
                    (e) => setError(String(e)),
                  );
              }}
            >
              Remove connection
            </Button>
          </DialogFooter>
          {error && <p role="alert">{error}</p>}
        </DialogPopup>
      </Dialog>
    </SettingsGroup>
  );
}

export function ProjectConnection({ project }: { project: string }) {
  const cloud = useCloud(),
    s = deviceLinks.use(),
    state = mobileAgents.use(),
    local = folders.use().get(project),
    os = platform.use();
  const [reviews, setReviews] = useState<HostReview[]>([]),
    [open, setOpen] = useState<HostReview>(),
    [problem, setProblem] = useState('');
  const allowed = os === 'macos' || os === 'ios' || import.meta.env.DEV;
  const link = activeProjectLink(project),
    host = state.connection?.id;
  const [accepting, setAccepting] = useState<string>();
  const loc = locationOf(project);
  useEffect(() => {
    if (allowed && !local) void refreshMobileAgents();
  }, [allowed, local?.folder.folderId]);
  useEffect(() => {
    setReviews([]);
    setOpen(undefined);
    setAccepting(undefined);
    setProblem('');
    if (!allowed || !host || (local && !local.missing)) return;
    let live = true,
      running = false;
    async function load() {
      if (!live || running || document.hidden) return;
      running = true;
      try {
        const reply = await mobileCall<HostReview[]>('GET', '/v1/locations/' + loc + '/reviews', undefined, host);
        if (!live) return;
        if (reply.status !== 200 || !Array.isArray(reply.body))
          throw new Error(
            reply.status === 403
              ? 'This project is not shared on this connection.'
              : 'Reviews are unavailable. Open the updated LeadingLight app on the Mac.',
          );
        setReviews(reply.body);
        setOpen((r) => reply.body.find((i) => i.report === r?.report));
        setProblem('');
      } catch (e) {
        if (live) {
          setProblem(e instanceof Error ? e.message : String(e));
          setReviews([]);
          setOpen(undefined);
        }
      } finally {
        running = false;
      }
    }
    void load();
    const timer = setInterval(load, 12000);
    window.addEventListener('focus', load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [allowed, host, loc, local?.folder.folderId, cloud.user?.id]);
  const last = useMemo(() => s.links.filter((l) => l.project === project && l.requester === s.session).at(-1), [s, project]);
  if (!allowed || (local && !local.missing) || (!host && (!cloud.user || s.owner !== cloud.user.id))) return null;
  return (
    <section aria-label="Project connection" className="my-3 border-y border-border/60">
      <SettingsRow
        label={
          <span className="flex items-center gap-2">
            <Monitor size={16} />
            {host ? state.connection?.name : 'Project work'}
          </span>
        }
        description={
          host
            ? problem || (state.online ? 'Agents run on this Mac.' : 'Checking this Mac…')
            : last?.state === 'denied'
              ? 'Request declined. You can ask again.'
              : last?.state === 'expired'
                ? 'Request expired. You can ask again.'
                : 'Connect to the Mac that has this project to see its agents and reviews.'
        }
      >
        {host && !problem && state.online ? (
          <span className="text-sm text-muted-foreground">Online</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (link) void selectLink(link).catch((e) => setProblem(String(e)));
              else connectionPicker.set({ project });
            }}
          >
            {host ? 'Reconnect' : 'Connect'}
          </Button>
        )}
      </SettingsRow>
      {reviews.map((r) => (
        <SettingsRow
          key={r.task}
          label={
            <span className="flex items-center gap-2">
              <FileCheck2 size={16} />
              {r.title}
            </span>
          }
          description={'Ready for review · ' + state.connection?.name}
        >
          <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
            Review
          </Button>
        </SettingsRow>
      ))}
      <Dialog
        open={!!open}
        onOpenChange={(v) => {
          if (!v) setOpen(undefined);
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>Ready for review · {state.connection?.name}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <h3 className="font-medium">{open?.reportTitle}</h3>
            <p className="whitespace-pre-wrap text-sm">{open?.text}</p>
          </DialogPanel>
          <DialogFooter>
            <Button
              disabled={!open || accepting === open.report}
              onClick={() => {
                if (!open) return;
                const id = open.report;
                setAccepting(id);
                void mobileCall('POST', '/v1/locations/' + loc + '/reviews/' + id + '/accept', {}, host)
                  .then((r) => {
                    if (r.status >= 400) throw new Error('Refresh the report before accepting it.');
                  })
                  .catch((e) => {
                    setProblem(String(e));
                    setAccepting(undefined);
                  });
              }}
            >
              {accepting === open?.report ? 'Waiting for Mac…' : 'Mark reviewed'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
