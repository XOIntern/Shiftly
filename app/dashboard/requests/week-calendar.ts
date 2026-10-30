// Pure helpers behind the week-start calendar. Calendar widgets speak local
// `Date`s, the rest of the app speaks "YYYY-MM-DD" strings: every conversion
// goes through the local y/m/d (never toISOString, which shifts a local
// midnight into the previous UTC day east of Greenwich) and all day arithmetic
// stays on the string/day-number side, so a DST change cannot move a day.

import { dayFromNumber, dayNumber, mondayOf } from "@/lib/dates";
import { weekDates } from "@/lib/week";
import type { RequestedWeek } from "@/types/mp-request";

// taken: an approved request holds the week (a new one would be refused);
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

// What a calendar refuses to let the user pick: `week` (the weekly form: a week
// already holding an open/approved request), `day` (the daily form: a day
// already holding an open daily request), or nothing (the roster, where the
// marks only inform).
export type CalendarBlocks = "week" | "day" | null;

// A day button's accessible name: the date, what its week holds, then what the
// day itself holds, so no mark is colour or shape alone. Only the thing the
// calendar blocks is called unavailable.
export function calendarDayAriaLabel(
  date: Date,
  {
    weekMark,
    hasDaily,
    blocks,
  }: { weekMark?: WeekMark; hasDaily: boolean; blocks: CalendarBlocks },
): string {
  const parts = [LONG_DAY.format(date)];
  if (weekMark === "taken") {
    parts.push(
      blocks === "week"
        ? "week already has a request, unavailable"
        : "week has an open or approved request",
    );
  }
  if (weekMark === "fulfilled") {
    parts.push(
      blocks === "week"
        ? "week has a fulfilled request, a new request is an addition"
        : "week has a fulfilled request",
    );
  }
  if (hasDaily) {
    parts.push(
      blocks === "day"
        ? "day already has a request, unavailable"
        : "daily request open",
    );
  }
  return parts.join(", ");
}

// The trigger's text for a chosen day, e.g. "Mon 5 Jan 2026".
export function formatDay(day: string): string {
  return SHORT_DAY.format(toLocalDate(day));
}

// Every day of the given weeks, for the calendar's per-day modifiers.
export function daysOfWeeks(mondays: Iterable<string>): Date[] {
  return [...mondays].flatMap((monday) => weekDates(monday).map(toLocalDate));
}
