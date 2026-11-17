import { htmlDoc, type EditorDoc } from "@leadinglight/editor/editor";

export type Mode = "notes" | "browser";
export type Item = { id: string; kind: "note" | "browser" | "calendar" | "mail"; title: string; type?: string; pinned?: boolean; doc?: EditorDoc; history?: string[]; at?: number };
export type Pane = { id: string; item: string };
export type Demo = { items: Item[]; panes: Pane[]; focus: string; mode: Mode; ratio: number };
export const STORAGE = "ll.sidebar-prototype.v1";
export const types = ["Pages", "Tags", "Daily notes", "People", "Books", "Meetings", "Projects", "Tasks", "Ideas", "Collections"];
export const sites = [
  { id: "kyoto", title: "Kyoto city guide", host: "kyoto-guide.example", section: "FIELD NOTES / JAPAN", heading: "A quieter side of Kyoto", intro: "Start early, take the smaller streets, and leave space for the unexpected. Three walks for a slower visit to the old capital.", parts: [["Before the city wakes", "Arrive at Fushimi Inari before 7 am. Walk past the first viewpoint: the crowds thin out as the trail climbs, and small shrines appear between the cedar trees."], ["An afternoon in the east", "Follow the Philosopher’s Path from north to south. Stop for tea, look into the small ceramic shops, and take the back streets toward Gion."], ["Along the Kamo River", "Pick up something for dinner and sit by the river. The stepping stones near Demachiyanagi are a good place to begin an evening walk."]], next: "rail", nextLabel: "Plan the train journey" },
  { id: "rail", title: "Tokyo to Kyoto by train", host: "rail-journal.example", section: "RAIL JOURNAL / ROUTES", heading: "Tokyo → Kyoto", intro: "A practical guide to the Tokaido Shinkansen. For this sample trip, allow a little over two hours on the Nozomi and book a seat before travel day.", parts: [["Choose your train", "Nozomi services make fewer stops. Hikari services take longer and can suit a slower itinerary. Check the ticket conditions for the pass you plan to use."], ["What to bring", "A small bag, a bento from the station, and a book for the journey. Keep larger luggage out of the aisle."], ["On arrival", "Kyoto Station has several exits. Save your hotel’s address before you leave, then follow signs to the central exit."]], next: "kyoto", nextLabel: "Explore Kyoto" },
  { id: "stay", title: "Staying in Higashiyama", host: "small-stays.example", section: "SMALL STAYS / KYOTO", heading: "Stay close to the old streets", intro: "A sample shortlist of small inns in Higashiyama, within walking distance of the river and the quieter lanes east of Gion.", parts: [["Garden house", "Six rooms around a small courtyard. Breakfast is served from seven. A good base for early walks."], ["The riverside inn", "Simple rooms, bicycles to borrow, and a reading room overlooking the water."], ["Before you book", "Compare cancellation terms and evening check-in times. These are fictional listings for trying the sidebar."]], next: "kyoto", nextLabel: "See the neighborhood guide" },
  { id: "reading", title: "The reading room", host: "reading-room.example", section: "THE READING ROOM / ESSAYS", heading: "Make room for a good book", intro: "A small collection of essays and reading notes for long journeys, quiet mornings, and the spaces between plans.", parts: [["On paying attention", "Travel leaves more room for noticing when the day is not planned to the minute. Bring one book you can return to."], ["A book for the train", "The Dispossessed, by Ursula K. Le Guin. A story about the worlds we build and the assumptions we carry with us."]], next: "rail", nextLabel: "A journey worth reading on" },
];
export const siteFor = (url: string) => sites.find((site) => url === site.id || url.replace(/^https?:\/\//, "").replace(/\/$/, "") === site.host);
export const currentURL = (item: Item) => item.history?.[item.at ?? 0] ?? "";
export const modeFor = (item?: Item): Mode => item?.kind === "browser" ? "browser" : "notes";

export function seed(): Demo {
  const note = (id: string, title: string, type: string, html: string, pinned = false): Item => ({ id, title, type, kind: "note", pinned, doc: htmlDoc(html) });
  return {
    mode: "notes", focus: "left", ratio: 50, panes: [{ id: "left", item: "kyoto-note" }],
    items: [
      note("kyoto-note", "Trip to Kyoto", "Pages", '<h2>Before we go</h2><p>Pack light, bring the good <strong>camera</strong>, and leave room for ceramics.</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Book the Hakone ryokan</p></li><li data-type="taskItem" data-checked="false"><p>Reserve seats on the Nozomi</p></li></ul><blockquote><p>Kyoto is best in the early morning, before the temples fill up.</p></blockquote><h2>Day plans</h2><ul><li><p>Morning at Fushimi Inari</p></li><li><p>Lunch in Gion</p></li><li><p>Evening walk along the Kamo river</p></li></ul>', true),
      note("reading-note", "Reading list", "Collections", "<h2>For the journey</h2><ul><li><p>The Dispossessed · Ursula K. Le Guin</p></li><li><p>In Praise of Shadows · Jun’ichirō Tanizaki</p></li><li><p>The Art of Noticing · Rob Walker</p></li></ul><p>One book for the train. One for the evenings.</p>", true),
      note("project-note", "LeadingLight", "Projects", "<h2>A calmer place to think</h2><p>Give the things I choose a permanent place. Let everything else be found when I need it.</p><h2>This week</h2><ul><li><p>Try a shared sidebar for notes and browsing.</p></li><li><p>Keep research and writing side by side.</p></li></ul>", true),
      note("today-note", "Monday, November 16", "Daily notes", "<h2>Today</h2><p>Finish the Kyoto plan, review the sidebar prototype, and leave time to read.</p><h2>A thought to keep</h2><p>The best tools leave you with fewer decisions.</p>"),
      note("meeting-note", "Design catch-up", "Meetings", "<h2>Monday · 10:00 am</h2><p>Review the sidebar with Maya. Try switching modes while a note and a browser page are open.</p><h2>Questions</h2><ul><li><p>Does the gesture feel predictable?</p></li><li><p>Is it clear which pane a click will change?</p></li></ul>"),
      note("book-note", "The Dispossessed", "Books", "<p>Ursula K. Le Guin · 1974</p><h2>Reading notes</h2><p>What do we take for granted about the way a society is organized?</p>"),
      note("idea-note", "A map of quiet places", "Ideas", "<p>A collection of libraries, riverside walks, and cafés that leave room to think.</p>"),
      note("task-note", "Reserve train seats", "Tasks", "<p>Choose a morning departure and check the luggage allowance.</p>"),
      note("person-note", "Maya Chen", "People", "<p>Design collaborator. Likes clear labels, good typography, and a long walk after a review.</p>"),
      note("tag-note", "Travel", "Tags", "<p>Plans, reading, and observations from somewhere new.</p>"),
      { id: "web-kyoto", kind: "browser", title: sites[0].title, history: ["kyoto"], at: 0 },
      { id: "web-rail", kind: "browser", title: sites[1].title, history: ["rail"], at: 0 },
      { id: "web-stay", kind: "browser", title: sites[2].title, history: ["stay"], at: 0 },
      { id: "calendar", kind: "calendar", title: "Calendar" },
      { id: "mail", kind: "mail", title: "Mail" },
      { id: "new-tab", kind: "browser", title: "New tab", history: [], at: 0 },
    ],
  };
}

export function restore(): Demo {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Demo;
    if (value && Array.isArray(value.items) && value.items.every((i) => typeof i.id === "string" && typeof i.title === "string") && value.items.some((i) => i.id === "new-tab") && value.panes?.length > 0 && value.panes.length <= 2 && value.panes.every((p) => value.items.some((i) => i.id === p.item))) {
      return { ...value, mode: value.mode === "browser" ? "browser" : "notes", ratio: Math.max(30, Math.min(70, Number(value.ratio) || 50)) };
    }
  } catch { /* A broken demo save starts from the sample again. */ }
  return seed();
}

// In a split, opening a note must not replace the research page beside it.
export function openItem(state: Demo, id: string, beside = false): Demo {
  const item = state.items.find((i) => i.id === id);
  if (!item) return state;
  const already = state.panes.find((p) => p.item === id);
  if (already) return { ...state, focus: already.id };
  if (beside && state.panes.length === 1) return { ...state, panes: [state.panes[0], { id: state.panes[0].id === "left" ? "right" : "left", item: id }], focus: state.panes[0].id === "left" ? "right" : "left" };
  const focused = state.panes.find((p) => p.id === state.focus);
  const sameKind = (p: Pane) => modeFor(state.items.find((i) => i.id === p.item)) === modeFor(item);
  const target = beside ? state.panes.find((p) => p.id !== state.focus) : focused && sameKind(focused) ? focused : state.panes.find(sameKind);
  const pane = target ?? state.panes.find((p) => p.id === state.focus) ?? state.panes[0];
  return { ...state, panes: state.panes.map((p) => p.id === pane.id ? { ...p, item: id } : p), focus: pane.id };
}
