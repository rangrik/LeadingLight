import type { DateValue } from "./catalog";

// Dates are stored as ISO days ("2026-10-22"), read and written in local time.
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromIso = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const moment = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatDate(v: DateValue): string {
  const [h, m] = (v.time ?? "").split(":").map(Number);
  const start = v.time ? moment.format(fromIso(v.start).setHours(h, m)) : day.format(fromIso(v.start));
  return v.end && v.end !== v.start ? `${start} – ${day.format(fromIso(v.end))}` : start;
}
export const formatMoment = (ms: number) => moment.format(ms);

export const isDateValue = (v: unknown): v is DateValue =>
  Boolean(v && typeof v === "object" && typeof (v as DateValue).start === "string");
