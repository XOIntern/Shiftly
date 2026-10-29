// Pure helpers behind the week-start calendar. Calendar widgets speak local
// `Date`s, the rest of the app speaks "YYYY-MM-DD" strings: every conversion
// goes through the local y/m/d (never toISOString, which shifts a local
// midnight into the previous UTC day east of Greenwich) and all day arithmetic
// stays on the string/day-number side, so a DST change cannot move a day.

import { dayFromNumber, dayNumber, mondayOf } from "@/lib/dates";
import { weekDates } from "@/lib/week";
import type { RequestedWeek } from "@/types/mp-request";

// taken: an open/approved request holds the week (a new one would be refused);
// fulfilled: only delivered demand, a later addition is still legal.
export type WeekMark = "taken" | "fulfilled";

// One mark per Monday; taken wins over fulfilled whatever the input order.
export function markedWeeks(weeks: RequestedWeek[]): Map<string, WeekMark> {
  const marks = new Map<string, WeekMark>();
  for (const { weekStart, status } of weeks) {
    if (status === "fulfilled") {
      if (!marks.has(weekStart)) marks.set(weekStart, "fulfilled");
    } else {
      marks.set(weekStart, "taken");
    }
  }
  return marks;
}

export function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toIso(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// The Monday-to-Sunday span a month grid shows: the Monday of the week holding
// the 1st through the Sunday of the week holding the last day. Asking the
// server for exactly this covers every visible cell, outside days included.
export function weekDayRange(month: Date): { from: string; to: string } {
  const first = toIso(new Date(month.getFullYear(), month.getMonth(), 1));
  const last = toIso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  return {
    from: mondayOf(first),
    to: dayFromNumber(dayNumber(mondayOf(last)) + 6),
  };
}

const LONG_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

// A day button's accessible name: the date plus what its week already holds,
// so the marker is never colour or shape alone.
export function dayAriaLabel(date: Date, mark: WeekMark | undefined): string {
  const label = LONG_DAY.format(date);
  if (mark === "taken") return `${label}, week already has a request, unavailable`;
  if (mark === "fulfilled") {
    return `${label}, week has a fulfilled request, a new request is an addition`;
  }
  return label;
}

// The trigger's text for a chosen week, e.g. "Mon 5 Jan 2026".
export function formatWeekStart(monday: string): string {
  return SHORT_DAY.format(toLocalDate(monday));
}

// Every day of the given weeks, for the calendar's per-day modifiers.
export function daysOfWeeks(mondays: Iterable<string>): Date[] {
  return [...mondays].flatMap((monday) => weekDates(monday).map(toLocalDate));
}
