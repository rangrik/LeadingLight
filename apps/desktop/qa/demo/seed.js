// Demo space for the UX review. Runs inside the browser build (dev server):
//   open the browser build with ?demo (App.tsx), or in the console:
//   const m = await import("/qa/demo/seed.js"); m.installFixture(); await m.seed();
// installFixture() answers the project runtime's routes with fixed agents, so tasks, the Feed
// and the Work table show real states without a berthd. seed() fills the space.

const DAY = 86400000;
const at = (daysAgo, hour = 10, min = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, min, 0, 0); return d.getTime(); };
const mins = (n) => Date.now() - n * 60e3;
const iso = (daysFromNow) => { const d = new Date(); d.setDate(d.getDate() + daysFromNow); return d.toISOString().slice(0, 10); };
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// ---- doc builders (ProseMirror JSON the editor stores) ----
const text = (t, marks) => ({ type: "text", text: t, ...(marks && { marks }) });
const b = (t) => text(t, [{ type: "bold" }]);
const i = (t) => text(t, [{ type: "italic" }]);
const code = (t) => text(t, [{ type: "code" }]);
const m = (id) => ({ type: "mention", attrs: { id, tag: false } });
const tg = (id) => ({ type: "mention", attrs: { id, tag: true } });
const inl = (xs) => xs.map((x) => (typeof x === "string" ? text(x) : x));
const p = (...xs) => ({ type: "paragraph", content: inl(xs) });
const h = (level, t) => ({ type: "heading", attrs: { level }, content: [text(t)] });
const li = (...xs) => ({ type: "listItem", content: [p(...xs)] });
const ul = (...items) => ({ type: "bulletList", content: items.map((x) => (Array.isArray(x) ? li(...x) : li(x))) });
const todo = (...items) => ({ type: "taskList", content: items.map(([checked, ...xs]) => ({ type: "taskItem", attrs: { checked }, content: [p(...xs)] })) });
const quote = (...xs) => ({ type: "blockquote", content: [p(...xs)] });
const link = (id) => ({ type: "pageLink", attrs: { id, view: null } });
const hr = () => ({ type: "horizontalRule" });
const doc = (...blocks) => ({ type: "doc", content: blocks });

// ---- the runtime fixture ----
export const RUNTIME = {
  location: "leadinglight",
  path: "/Users/you/work/LeadingLight",
  conversations: [
    { id: "conv-pricing", agent: "claude", location: "leadinglight/pricing-copy", dir: "/Users/you/work/LeadingLight", session: "sess-pricing", live: true, title: "Write the pricing page copy", created: ago(3 * 3600e3) },
    { id: "conv-tabs", agent: "codex", location: "leadinglight", dir: "/Users/you/work/LeadingLight", session: "sess-tabs", live: true, title: "Fix the tab row overflow", created: ago(40 * 60e3) },
    { id: "conv-audit", agent: "claude", location: "leadinglight", dir: "/Users/you/work/LeadingLight", session: "sess-audit", live: true, title: "Audit the empty states", created: ago(5 * 3600e3) },
    { id: "conv-rename", agent: "claude", location: "leadinglight", dir: "/Users/you/work/LeadingLight", session: "sess-rename", live: false, title: "Rename Pages to Notes in the sidebar", created: ago(2 * DAY) },
  ],
  sessions: [
    { name: "sess-pricing", agent_state: "waiting", state_since: ago(6 * 60e3), exited: false, driver: "claude", agent: "claude", created: ago(3 * 3600e3) },
    { name: "sess-tabs", agent_state: "running", state_since: ago(2 * 60e3), exited: false, driver: "codex", agent: "codex", created: ago(40 * 60e3) },
    { name: "sess-audit", agent_state: "idle", state_since: ago(50 * 60e3), exited: false, driver: "claude", agent: "claude", created: ago(5 * 3600e3) },
    { name: "sess-rename", agent_state: "finished", state_since: ago(DAY), exited: true, driver: "claude", agent: "claude", created: ago(2 * DAY) },
  ],
  requests: {
    "sess-pricing": [
      {
        id: "req-1", generation: 1, kind: "question", blocking: true, state: "pending", opened: Date.now() - 6 * 60e3,
        questions: [{ question: "Should the pricing page lead with the monthly or the yearly price?", header: "Pricing", options: [{ label: "Monthly", description: "Simpler to explain" }, { label: "Yearly", description: "What most people buy" }] }],
      },
    ],
  },
};

export function installFixture() {
  if (window.__llFixture) return;
  window.__llFixture = true;
  const real = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.origin);
    const path = u.pathname;
    if (path.startsWith("/api/")) return Promise.resolve(json({ ready: false, providers: [] }));
    if (!path.startsWith("/__runtime")) return real(input, init);
    const r = path.replace("/__runtime", "");
    const method = (init?.method ?? "GET").toUpperCase();
    if (r === "/status") return Promise.resolve(json({ state: "ready", version: "fixture", home: "/tmp/fixture" }));
    if (method !== "GET") return Promise.resolve(json({ error: "The review fixture is read-only." }, 405));
    if (r === "/v1/locations") return Promise.resolve(json([{ name: RUNTIME.location, path: RUNTIME.path, folder_id: "f-ll" }]));
    if (r === "/v1/conversations") return Promise.resolve(json(RUNTIME.conversations));
    if (r === "/v1/sessions") return Promise.resolve(json(RUNTIME.sessions));
    if (r === "/v1/notify") return Promise.resolve(json([]));
    if (r === "/v1/events") return new Promise(() => {}); // an open stream that never speaks
    let x;
    if ((x = /^\/v1\/sessions\/([^/]+)\/requests$/.exec(r))) return Promise.resolve(json(RUNTIME.requests[x[1]] ?? []));
    if (/^\/v1\/sessions\/[^/]+\/draft$/.test(r)) return Promise.resolve(json({ text: "" }));
    if (/^\/v1\/(sessions|conversations)\/[^/]+\/(transcript|record)$/.test(r)) return Promise.resolve(json({ source: "claude", items: [], next: 0 }));
    if (/^\/v1\/(sessions|conversations)\/[^/]+\/(turns|outputs|workers|runs|queued|sessions)$/.test(r)) return Promise.resolve(json([]));
    if (/^\/v1\/sessions\/[^/]+$/.test(r)) return Promise.resolve(json(RUNTIME.sessions.find((s) => r.endsWith(s.name)) ?? { error: "no session" }, 200));
    if (/^\/v1\/conversations\/[^/]+$/.test(r)) return Promise.resolve(json(RUNTIME.conversations.find((c) => r.endsWith(c.id)) ?? { error: "no conversation" }, 200));
    return Promise.resolve(json({ error: `fixture: ${r}` }, 404));
  };
}

let seeding;
export const seed = () => (seeding ??= fill());

async function fill() {
  const { createPage, savePage } = await import("/src/lib/space.ts");
  const { objects } = await import("/src/lib/objects.ts");
  const { projectPrefs } = await import("/src/lib/project-runtime/prefs.ts");
  const { ensureDaily, today, shiftDay } = await import("/src/lib/daily.ts");
  const ids = {};
  const make = async (key, init) => {
    const obj = await createPage(init);
    ids[key] = obj.id;
    return obj.id;
  };
  // Ids chosen ahead, so pages that link each other are written once, at their own times.
  const notesId = crypto.randomUUID();
  const loopsId = crypto.randomUUID();
  const cap = (kind, capturedAt, reviewedAt) => ({ captureInbox: { kind, capturedAt, ...(reviewedAt && { reviewedAt }) } });

  // Tags
  const reading = await make("tagReading", { title: "reading", typeId: "tag", createdAt: at(20), updatedAt: at(20) });
  const systems = await make("tagSystems", { title: "systems", typeId: "tag", createdAt: at(19), updatedAt: at(19) });
  const design = await make("tagDesign", { title: "design", typeId: "tag", createdAt: at(18), updatedAt: at(18) });

  // People
  const meadows = await make("meadows", { title: "Donella Meadows", typeId: "person", properties: { company: "Sustainability Institute", tags: [systems] }, createdAt: at(12), updatedAt: at(12) });
  const norman = await make("norman", { title: "Don Norman", typeId: "person", properties: { company: "Nielsen Norman Group", tags: [design] }, createdAt: at(30), updatedAt: at(30) });
  const ahrens = await make("ahrens", { title: "Sönke Ahrens", typeId: "person", properties: {}, createdAt: at(9), updatedAt: at(9) });
  const sam = await make("sam", { title: "Sam Rivera", typeId: "person", properties: { company: "Acme Studio", email: "sam@acme.studio" }, createdAt: at(40), updatedAt: at(3) });
  const priya = await make("priya", { title: "Priya Nair", typeId: "person", properties: { company: "Acme Studio" }, createdAt: at(40), updatedAt: at(10) });

  // Projects
  const ll = await make("ll", {
    title: "LeadingLight", typeId: "project", createdAt: at(60), updatedAt: mins(95),
    properties: { "project-status": ["active"], due: { start: iso(37) }, tags: [design], icon: { kind: "icon", name: "sun", color: "purple" } },
    content: doc(
      p("A local-first notes app that helps me think. Every note is an object of a type; agents work beside the notes, never in them."),
      h(2, "This month"),
      ul(["Ship the pricing page and the first public build."], ["Make Today the place to start the day."], ["Review agent reports without leaving the task."]),
      h(2, "Open questions"),
      ul(["Does the sidebar lead with types or with projects?"], [m(sam), " thinks the bar needs labels."]),
    ),
  });
  const office = await make("office", { title: "Home office", typeId: "project", createdAt: at(25), updatedAt: at(6), properties: { "project-status": ["planned"], tags: [] }, content: doc(p("A quieter desk, a second screen, better light.")) });

  // Books
  const tis = await make("tis", {
    title: "Thinking in Systems", typeId: "book", createdAt: at(12), updatedAt: at(1, 21),
    properties: { author: [meadows], rating: 5, "book-status": ["reading"], tags: [reading, systems], description: "A primer on stocks, flows, feedback and leverage." },
    content: doc(p("Reading it slowly, a chapter a week. Notes live in ", m(notesId), "."), p("The one idea so far: you can't understand a system from its parts; look at the ", b("structure"), " that produces its behaviour.")),
  });
  const doet = await make("doet", {
    title: "The Design of Everyday Things", typeId: "book", createdAt: at(50), updatedAt: at(19),
    properties: { author: [norman], rating: 4, "book-status": ["read"], finished: { start: iso(-19) }, tags: [reading, design] },
    content: doc(p("Affordances, signifiers, mapping, feedback. Read for the second time; the chapter on errors is the one that aged best.")),
  });
  const smart = await make("smart", { title: "How to Take Smart Notes", typeId: "book", createdAt: at(9), updatedAt: at(9), properties: { author: [ahrens], "book-status": ["to-read"], tags: [reading] } });

  // Concept pages
  const stocks = await make("stocks", {
    title: "Stocks and flows", typeId: "page", createdAt: at(5, 20), updatedAt: at(5, 20, 40), properties: { tags: [systems], icon: { kind: "emoji", value: "🪣" } },
    content: doc(p("A ", b("stock"), " is what you can see, feel, count or measure at a moment: water in a bathtub, money in an account, trust in a team."), p("A ", b("flow"), " changes a stock over time. Inflows fill, outflows drain. A stock changes only as fast as its flows allow, which is why systems have ", i("momentum"), "."), quote("A stock takes time to change, because flows take time to flow.", " — ", m(meadows)), p("See ", m(loopsId), " for how stocks drive their own flows.")),
  });
  const loops = await make("loops", {
    id: loopsId, title: "Feedback loops", typeId: "page", createdAt: at(4, 19), updatedAt: at(4, 19, 30), properties: { tags: [systems], icon: { kind: "emoji", value: "🔁" } },
    content: doc(p("A feedback loop is a closed chain of causes: a stock's level sets a flow that changes the stock."), ul([b("Balancing"), " loops seek a goal: a thermostat, a thirst, a budget."], [b("Reinforcing"), " loops compound: interest, population, a habit."]), p("Delays in a loop make it oscillate. That is most of what goes wrong in projects: the signal arrives after the decision.")),
  });

  // The long reading note, left mid-sentence yesterday
  const notes = await make("notes", {
    id: notesId, title: "Notes on Thinking in Systems", typeId: "page", createdAt: at(6, 21), updatedAt: at(1, 22, 10),
    properties: { tags: [reading, systems], icon: { kind: "emoji", value: "📘" } },
    content: doc(
      p("Reading notes on ", m(tis), " by ", m(meadows), ". One section per chapter; my own words first, quotes second."),
      h(2, "1. The basics"),
      p("A system is more than the sum of its parts because of the ", b("interconnections"), ". Change the parts and little happens; change the connections and the whole thing behaves differently. This is the idea I keep coming back to for LeadingLight: the links between notes matter more than the notes."),
      p("Two building blocks: ", m(stocks), " and ", m(loops), ". Everything else in the book is built from them."),
      quote("The behavior of a system cannot be known just by knowing the elements of which the system is made."),
      h(2, "2. A brief visit to the systems zoo"),
      ul(["One stock with two competing balancing loops: a thermostat. The room never sits exactly at the set point."], ["One stock with one reinforcing and one balancing loop: population, capital, any growth that eventually meets a limit."], ["Two stocks: a renewable resource and the industry that draws on it. Overshoot comes from delays."]),
      todo([true, "Draw the thermostat loop by hand"], [false, "Reread the renewable resource example with the delay marked"], [false, "Ask ", m(sam), " whether delays explain our release slips"]),
      h(2, "3. Why systems work so well"),
      p("Resilience, self-organization, hierarchy. Resilience is a stock too: it drains quietly and you only notice when it is gone."),
      p("The hierarchy point is useful for the app: subsystems should serve the whole, but each needs room to run itself. A project's agents are a subsystem."),
      hr(),
      h(2, "Delays"),
      p("Meadows keeps returning to delays. A delay in a balancing loop produces oscillation; a long delay in a reinforcing loop produces overshoot and collapse."),
      p("The point about delays in a feedback loop is that"),
    ),
  });

  // Other pages
  const weekly = await make("weekly", {
    title: "Weekly review", typeId: "page", createdAt: at(2, 18), updatedAt: at(2, 18, 45), properties: { icon: { kind: "icon", name: "calendar-check", color: "teal" } },
    content: doc(h(2, "What moved"), ul(["Pricing copy went to an agent; first draft back."], ["Two chapters of ", m(tis), "."]), h(2, "What I learned"), ul(["Delays are the thing to watch, in systems and in projects."]), h(2, "Next week"), todo([false, "Decide monthly vs yearly"], [false, "Review the empty-states audit"], [false, "Reread chapter 3"])),
  });
  const pricing = await make("pricing", {
    title: "Pricing notes", typeId: "page", createdAt: at(8), updatedAt: at(3, 11), properties: { tags: [design] },
    content: doc(p("Two tiers for now: Personal and Team. Personal is one Mac, one space; Team adds shared spaces."), p("Monthly is simpler to explain; yearly is what most people buy. Lead with one, show the other in smaller type."), ul(["Personal: $8 a month or $80 a year."], ["Team: $15 a seat a month."]), p("Compare with Craft, Capacities and Obsidian Sync before settling. ", m(sam), " has the competitor sheet.")),
  });
  const untitled = await make("untitled", {
    title: "", typeId: "page", createdAt: at(2, 9, 12), updatedAt: at(2, 9, 20),
    content: doc(p("The sidebar should lead with projects, not with types. The Recent list is where I actually live, and it is at the bottom under ten rows of types I open once a week.")),
  });
  const leverage = await make("leverage", {
    title: "Leverage Points: Places to Intervene in a System", typeId: "page", createdAt: at(3, 13), updatedAt: at(3, 13),
    properties: { sourceUrl: "https://donellameadows.org/archives/leverage-points-places-to-intervene-in-a-system/", capturedAt: new Date(at(3, 13)).toISOString(), ...cap("web", at(3, 13), at(2, 10)), tags: [systems] },
    content: doc(p("Saved from donellameadows.org. Twelve leverage points, from constants and parameters at the bottom to the power to transcend paradigms at the top.")),
  });

  // Collection
  await make("list", { title: "Reading list 2026", typeId: "collection", createdAt: at(15), updatedAt: at(9), properties: { items: [tis, doet, smart], tags: [reading] } });

  // Meeting
  const meeting = await make("meeting", {
    title: "Design review with Sam", typeId: "meeting", createdAt: at(1, 15), updatedAt: at(1, 16, 5),
    properties: { when: { start: iso(-1) }, attendees: [sam, priya], project: [ll], tags: [design] },
    content: doc(ul(["Sam: the bar's icons need labels; nobody guesses Suggestions."], ["Priya: Today should show the projects, not a blank note."], ["Agreed to try three options and pick by using them."]), todo([false, "Send Sam the pricing draft"], [true, "Book the next review"])),
  });

  // Tasks
  const taskA = await make("taskA", {
    title: "Write the pricing page copy", typeId: "task", createdAt: at(3, 10), updatedAt: mins(70),
    properties: { "task-project": [ll], due: { start: iso(4) }, tags: [] },
    content: doc(p("Write the copy for the pricing page: a hero line, the two tiers, and the FAQ. Keep it in the voice of the rest of the site: plain, short, no exclamation marks."), p("Source: ", m(pricing), "."), ul(["Hero line under twelve words."], ["Tiers as a table, monthly and yearly."], ["FAQ: five questions at most."])),
  });
  const subHero = await make("subHero", { title: "Hero line", typeId: "task", createdAt: at(2, 11), updatedAt: at(1, 12), properties: { "task-project": [ll], "subtask-of": [taskA], done: true } });
  const subTiers = await make("subTiers", { title: "Tier table", typeId: "task", createdAt: at(2, 11, 1), updatedAt: at(2, 11, 1), properties: { "task-project": [ll], "subtask-of": [taskA], after: [subHero] } });
  const taskB = await make("taskB", {
    title: "Fix the tab row overflow", typeId: "task", createdAt: at(1, 9), updatedAt: mins(50), properties: { "task-project": [ll], due: { start: iso(2) } },
    content: doc(p("With six or more tabs the tab row overflows the card and the + button disappears. Tabs should shrink to a minimum and then scroll, as Safari's do.")),
  });
  const taskC = await make("taskC", {
    title: "Audit the empty states", typeId: "task", createdAt: at(1, 8), updatedAt: mins(60), properties: { "task-project": [ll] },
    content: doc(p("List every empty state in the app (no page, no captures, no suggestions, the Feed) and say what each should say and offer.")),
  });
  const taskD = await make("taskD", {
    title: "Rename Pages to Notes in the sidebar", typeId: "task", createdAt: at(3, 9), updatedAt: at(1, 17), properties: { "task-project": [ll], done: true, accepted: { at: at(1, 17) } },
    content: doc(p("The starter type is called Page but the docs say note everywhere.")),
  });
  await make("taskE", { title: "Read chapter 3 of Thinking in Systems", typeId: "task", createdAt: mins(130), updatedAt: mins(130), properties: { due: { start: iso(0) } } });
  await make("taskF", { title: "Call Sam about the invoice before Friday", typeId: "task", createdAt: at(4, 9), updatedAt: at(4, 9), properties: { "task-project": [ll] } });

  // Agents and reports (the runtime fixture names these sessions)
  const run = (conversation, session, location, agent) => ({ conversation, session, location, agent });
  const agentA = await make("agentA", {
    title: "Claude: Write the pricing page copy", typeId: "agent", createdAt: mins(240), updatedAt: mins(10),
    properties: {
      "agent-task": [taskA], "agent-profile": "Claude", run: run("conv-pricing", "sess-pricing", "leadinglight/pricing-copy", "claude"),
      work: { activity: "Drafting the three tiers", at: Date.now() - 6 * 60e3, checklist: [{ text: "Read the pricing notes", done: true }, { text: "Draft the hero line", done: true }, { text: "Write the tiers as a table" }, { text: "Publish the draft" }] },
      asks: [{ question: "Should the pricing page lead with the monthly or the yearly price?", about: [{ page: pricing, quote: "Monthly is simpler to explain" }], at: Date.now() - 6 * 60e3 }],
    },
  });
  await make("reportA1", {
    title: "Pricing copy, first draft", typeId: "report", createdAt: mins(80), updatedAt: mins(80),
    properties: { parent: taskA, report: { by: agentA, session: "sess-pricing", to: taskA, at: mins(80), command: "c-a1", sources: [{ page: pricing, quote: "Monthly is simpler to explain" }] } },
    content: doc(h(2, "Hero"), p(b("Notes that think with you."), " Every note is an object; links go both ways; agents work beside your words, never in them."), h(2, "Tiers"), ul([b("Personal"), " · one Mac, one space · $8 a month or $80 a year"], [b("Team"), " · shared spaces, roles · $15 a seat a month"]), h(2, "Open"), p("I lead with the monthly price because the notes say it is simpler to explain. If most people buy yearly, I should flip it; see my question.")),
  });
  const agentB = await make("agentB", {
    title: "Codex: Fix the tab row overflow", typeId: "agent", createdAt: mins(45), updatedAt: mins(3),
    properties: { "agent-task": [taskB], "agent-profile": "Codex", run: run("conv-tabs", "sess-tabs", "leadinglight", "codex"), work: { activity: "Running the QA specs", at: Date.now() - 2 * 60e3, checklist: [{ text: "Reproduce with eight tabs", done: true }, { text: "Set a minimum tab width", done: true }, { text: "Scroll the row when it overflows" }, { text: "Keep the + button in view" }, { text: "Run qa/panes.spec.ts" }] } },
  });
  const agentC = await make("agentC", {
    title: "Claude: Audit the empty states", typeId: "agent", createdAt: mins(300), updatedAt: mins(60),
    properties: { "agent-task": [taskC], "agent-profile": "Claude", run: run("conv-audit", "sess-audit", "leadinglight", "claude"), work: { checklist: [{ text: "List every empty state", done: true }, { text: "Write what each should say", done: true }, { text: "Publish", done: true }], at: mins(55) } },
  });
  await make("reportC1", {
    title: "Empty states audit", typeId: "report", createdAt: mins(55), updatedAt: mins(60),
    properties: { parent: taskC, report: { by: agentC, session: "sess-audit", to: taskC, at: mins(55), command: "c-c1", ready: true } },
    content: doc(p("Seven empty states. Four say what the place is for; three only say that it is empty."), ul([b("No page open"), " · says create a page. Could offer Today and the last page instead."], [b("Suggestions · Nothing yet"), " · two words. Should say when Tail speaks."], [b("Feed"), " · good: says what will show here."], [b("Captures"), " · good."], [b("A new tab"), " · same as No page open."]), p("Recommendation: one sentence per empty state saying when it fills, and one button that leads somewhere.")),
  });
  const agentD = await make("agentD", {
    title: "Claude: Rename Pages to Notes in the sidebar", typeId: "agent", createdAt: at(3, 9, 30), updatedAt: at(1, 16),
    properties: { "agent-task": [taskD], "agent-profile": "Claude", run: run("conv-rename", "sess-rename", "leadinglight", "claude") },
  });
  const reportD = await make("reportD1", {
    title: "Renamed in the starter types", typeId: "report", createdAt: at(1, 16), updatedAt: at(1, 16),
    properties: { parent: taskD, report: { by: agentD, session: "sess-rename", to: taskD, at: at(1, 16), command: "c-d1", ready: true } },
    content: doc(p("Changed the starter type's name and plural; the docs already said note.")),
  });
  await savePage(taskD, { properties: { "task-project": [ll], done: true, accepted: { at: at(1, 17), report: reportD } } });

  // Captured ideas, unfiled (Tail's "4 ideas since Tuesday")
  await make("idea1", { title: "Add a weekly review page that pulls This day from each day of the week", typeId: "idea", createdAt: at(5, 14, 2), updatedAt: at(5, 14, 2), properties: { ...cap("idea", at(5, 14, 2)) } });
  await make("idea2", { title: "Fix the LeadingLight tab close button jumping on hover", typeId: "idea", createdAt: at(4, 16, 40), updatedAt: at(4, 16, 40), properties: { ...cap("idea", at(4, 16, 40)) } });
  await make("idea3", { title: "Try reading Thinking in Systems chapter 4 on paper first", typeId: "idea", createdAt: at(3, 21, 15), updatedAt: at(3, 21, 15), properties: { ...cap("idea", at(3, 21, 15)) } });
  await make("idea4", { title: "Ask Sam whether LeadingLight should show word counts by default", typeId: "idea", createdAt: at(1, 11, 5), updatedAt: at(1, 11, 5), properties: { ...cap("idea", at(1, 11, 5)) } });

  // Daily notes
  const todayId = await ensureDaily(today());
  ids.today = todayId;
  await savePage(todayId, { content: doc(p("Quiet morning. Reviewed ", m(pricing), " and still can't decide monthly or yearly; the agent is asking the same thing."), todo([false, "Decide monthly vs yearly before the design review"], [false, "Read chapter 3"]), p("Noticed: I open the app, look at Today, and then go hunting in Recent for where I was.")) });
  const yday = await ensureDaily(shiftDay(today(), -1));
  await savePage(yday, { content: doc(p("Read chapter 2 of ", m(tis), ". Delays in ", m(loops), " are the key idea; see ", m(notes), "."), p("Design review with Sam in the afternoon.")) });
  const thu = await ensureDaily(shiftDay(today(), -3));
  await savePage(thu, { content: doc(p("Saved the leverage points essay. Worth a page of its own.")) });

  // The project's linked folder, and projects on
  await objects.putFolder({ pageId: ll, path: RUNTIME.path, folderId: "f-ll", location: RUNTIME.location, createdAt: at(30), updatedAt: at(30) });
  projectPrefs.set({ enabled: true });
  localStorage.setItem("ll.ai", JSON.stringify({ model: "opus", effort: "medium", access: "ask", plan: false, tail: { mode: "normal" } }));
  window.__seed = ids;
  return ids;
}
