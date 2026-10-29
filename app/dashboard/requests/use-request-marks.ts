"use client";

import { useMemo } from "react";

import { loadRequestedDays, loadRequestedWeeks } from "./actions";
import { useMonthLookup } from "./use-month-lookup";
import {
  daysOfWeeks,
  markedWeeks,
  toLocalDate,
  type WeekMark,
} from "./week-calendar";

// Everything a request calendar needs to draw its marks for the visible month:
// the weeks holding a weekly request and the days holding an open daily one,
// as the Dates the day picker's modifiers take plus the lookups its labels
// use. Nothing is fetched while `enabled` is false or no location is chosen.
export function useRequestMarks(
  locationId: string | null,
  enabled: boolean,
  month: Date,
) {
  const weeks = useMonthLookup(locationId, enabled, month, loadRequestedWeeks);
  const dates = useMonthLookup(locationId, enabled, month, loadRequestedDays);

  return useMemo(() => {
    const weekMarks = markedWeeks(weeks);
    const mondaysWith = (mark: WeekMark) =>
      [...weekMarks].filter(([, m]) => m === mark).map(([monday]) => monday);
    return {
      weekMarks,
      dailyDates: new Set(dates),
      takenDays: daysOfWeeks(mondaysWith("taken")),
      fulfilledDays: daysOfWeeks(mondaysWith("fulfilled")),
      dailyDays: dates.map(toLocalDate),
    };
  }, [weeks, dates]);
}
