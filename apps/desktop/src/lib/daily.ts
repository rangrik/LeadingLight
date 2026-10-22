import { fromIso, isoDay } from "./format";
import { createPage, space } from "./space";

export const DAILY = "daily";

const long = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dailyTitle = (day: string) => long.format(fromIso(day));

export const today = () => isoDay(new Date());
export const shiftDay = (day: string, by: number) => {
  const d = fromIso(day);
  d.setDate(d.getDate() + by);
  return isoDay(d);
};

export const dailyFor = (day: string) => space.get().pages.find((p) => p.typeId === DAILY && p.properties.day === day);

// One page per day, made the first time the day is opened or linked.
const making = new Map<string, Promise<string>>();
export function ensureDaily(day: string): Promise<string> {
  const found = dailyFor(day);
  if (found) return Promise.resolve(found.id);
  let made = making.get(day);
  if (!made) {
    made = createPage({ typeId: DAILY, title: dailyTitle(day), properties: { day } }).then((p) => p.id);
    making.set(day, made);
    void made.finally(() => making.delete(day));
  }
  return made;
}
