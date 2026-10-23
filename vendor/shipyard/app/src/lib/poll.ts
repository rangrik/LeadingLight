// poll runs a look at something on a box (or the laptop agent) again and
// again, the way the app's backstops should: often while it shows and
// changes, less often while nothing changes, and not at all while the
// window is hidden (minimised, covered, on another Space, or the Mac
// asleep). Coming back looks at once, then carries on as before.
//
//   const stop = poll(async () => changed, { every: 2000, max: 16_000 });
//
// look returns whether it found anything new: true goes back to every,
// false doubles the wait up to max, and nothing (undefined) keeps it. A
// look that throws counts as nothing new. kick() looks now (an event said
// something changed), or as soon as every has passed since the last look,
// and goes back to every.
//
// A timer that fires much later than it was set for means the Mac slept:
// that look counts as coming back, too.

export interface PollOptions {
  // The wait while things change, in ms.
  every: number;
  // The longest wait while nothing does (default: every, no backing off).
  max?: number;
  // Look while the window is hidden, this often (default: never).
  hidden?: number;
  // Look at once when started (default true).
  now?: boolean;
}

export interface Poller {
  stop(): void;
  kick(): void;
}

// The page's visibility, through this so tests can stand in for it.
const hiddenNow = () => typeof document !== "undefined" && document.hidden;

export function poll(look: () => unknown, o: PollOptions): Poller {
  const max = Math.max(o.every, o.max ?? o.every);
  let wait = o.every;
  let timer = 0;
  let due = 0;
  let busy = false;
  let again = false;
  let stopped = false;
  let started = 0;

  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    timer = 0;
    if (stopped) return;
    if (hiddenNow() && o.hidden === undefined) return;
    due = Date.now() + ms;
    timer = window.setTimeout(run, ms);
  };

  const run = async () => {
    timer = 0;
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    if (hiddenNow() && o.hidden === undefined) return;
    // Late by far more than the wait: the Mac slept.
    if (due && Date.now() - due > Math.max(10_000, wait)) wait = o.every;
    busy = true;
    started = Date.now();
    let changed: unknown;
    try {
      changed = await look();
    } catch {
      changed = false;
    } finally {
      busy = false;
    }
    if (stopped) return;
    if (changed === true) wait = o.every;
    else if (changed === false) wait = Math.min(max, wait * 2);
    if (again) {
      again = false;
      return run();
    }
    schedule(hiddenNow() && o.hidden !== undefined ? Math.max(o.hidden, wait) : wait);
  };

  const onVisibility = () => {
    if (stopped) return;
    if (hiddenNow()) {
      if (o.hidden === undefined) {
        window.clearTimeout(timer);
        timer = 0;
      }
      return;
    }
    // Back: look now, as after a change.
    wait = o.every;
    void run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (o.now === false) schedule(wait);
  else void run();

  return {
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      timer = 0;
      document.removeEventListener("visibilitychange", onVisibility);
    },
    kick() {
      if (stopped) return;
      wait = o.every;
      // Never more often than every: a burst of kicks is one look.
      const since = Date.now() - started;
      if (busy || since >= o.every) void run();
      else schedule(o.every - since);
    },
  };
}
