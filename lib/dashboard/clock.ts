import { dayFromNumber, dayNumber, mondayOf, todayIn } from "@/lib/dates";
import type { LocationTimezone } from "@/types/timezone";

// pastDays: the 7 dates before today, oldest first.
export type LocationClock = {
  today: string;
  week: string;
  nextWeek: string;
  pastDays: string[];
};

// "Today" and "this week" are decided in the location's own zone, never the
// server's: a Jayapura location is a calendar day ahead of Jakarta for part of
// every evening. `now` is injected so callers (and tests) own the clock.
export function clockFor(zone: LocationTimezone, now: Date): LocationClock {
  const today = todayIn(zone, now);
  const week = mondayOf(today);
  const todayNumber = dayNumber(today);
  return {
    today,
    week,
    nextWeek: dayFromNumber(dayNumber(week) + 7),
    pastDays: Array.from({ length: 7 }, (_, i) =>
      dayFromNumber(todayNumber - 7 + i),
    ),
  };
}
