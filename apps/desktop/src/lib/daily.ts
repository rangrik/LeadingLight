import { fromIso, isoDay } from "./format";
import type { ObjectSummary } from "./objects";
import { draft, findDraft, space, storeDraft } from "./space";
import { newObject } from "./store";
import { newPage, pageInit } from "./templates";

export const DAILY = "daily";

const long = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dailyTitle = (day: string) => long.format(fromIso(day));

export const today = () => isoDay(new Date());
export const shiftDay = (day: string, by: number) => {
  const d = fromIso(day);
  d.setDate(d.getDate() + by);
  return isoDay(d);
};

const isDay = (day: string) => (p: ObjectSummary) => p.typeId === DAILY && p.properties.day === day;
export const dailyFor = (day: string) => space.get().pages.find(isDay(day));
// The id a day shows under: its page, or the draft of it.
export const dayShown = (day: string) => (dailyFor(day) ?? findDraft(isDay(day)))?.id;

// The page to open for a day. A day not yet written in opens as a draft, stored by its first edit.
export async function dayPage(day: string): Promise<string> {
  const shown = dayShown(day);
  if (shown) return shown;
  const init = await pageInit(DAILY, { title: dailyTitle(day), properties: { day } });
  return dayShown(day) ?? draft(newObject(init));
}

// One page per day, stored the first time the day is linked (or its draft is).
const making = new Map<string, Promise<string>>();
export function ensureDaily(day: string): Promise<string> {
  const found = dailyFor(day);
  if (found) return Promise.resolve(found.id);
  const open = findDraft(isDay(day));
  if (open) return storeDraft(open.id).then(() => open.id);
  let made = making.get(day);
  if (!made) {
    made = newPage(DAILY, { title: dailyTitle(day), properties: { day } }).then((p) => p.id);
    making.set(day, made);
    void made.finally(() => making.delete(day));
  }
  return made;
}
