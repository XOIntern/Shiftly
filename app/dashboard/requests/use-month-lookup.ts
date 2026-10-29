"use client";

import { useEffect, useMemo, useState } from "react";

import { toIso, toLocalDate, weekDayRange } from "./week-calendar";

// The calendars' marker feed: asks the server for exactly the days the visible
// month grid shows and caches each answer under `locationId|month`, so a
// location switch can never surface another location's marks. A failed fetch
// just leaves the calendar unmarked. `load` must be a stable reference (a
// module-level server action), it is an effect dependency.
export function useMonthLookup<T>(
  locationId: string | null,
  enabled: boolean,
  month: Date,
  load: (locationId: string, from: string, to: string) => Promise<T[]>,
): T[] {
  const [fetched, setFetched] = useState<Record<string, T[]>>({});

  const monthKey = toIso(month).slice(0, 7);
  const active = enabled && locationId !== null;

  useEffect(() => {
    if (!active || locationId === null) return;
    const key = `${locationId}|${monthKey}`;
    const { from, to } = weekDayRange(toLocalDate(`${monthKey}-01`));
    let current = true;
    load(locationId, from, to)
      .then((items) => {
        if (current) setFetched((prev) => ({ ...prev, [key]: items }));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, locationId, monthKey, load]);

  return useMemo(() => {
    if (!active) return [];
    const prefix = `${locationId}|`;
    return Object.entries(fetched)
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, items]) => items);
  }, [active, locationId, fetched]);
}
