"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { FieldDescription } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { mondayOf } from "@/lib/dates";
import type { RequestedWeek } from "@/types/mp-request";

import { loadRequestedWeeks } from "./actions";
import {
  dayAriaLabel,
  daysOfWeeks,
  formatWeekStart,
  markedWeeks,
  toIso,
  toLocalDate,
  weekDayRange,
  type WeekMark,
} from "./week-calendar";

// Marker styling lives on the day cell (it already carries `relative`): the
// whole Monday-to-Sunday row is shaded when taken, and every cell gets a dot —
// filled for taken, outlined for fulfilled — so state never rests on colour.
const DOT =
  "after:absolute after:bottom-0 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full";
const MODIFIER_CLASS_NAMES = {
  taken: `bg-muted rounded-none first:rounded-l-(--cell-radius) last:rounded-r-(--cell-radius) ${DOT} after:bg-foreground`,
  fulfilled: `${DOT} after:border after:border-foreground`,
};

// The weekly create form's "Week start": a Monday-start calendar that marks
// the weeks the chosen location already has a live request for. Picking any
// day stores that week's Monday. Markers are fetched per visible month and
// cached under `locationId|month`, so a location switch can never show another
// location's weeks; a failed fetch just leaves the calendar unmarked.
export function WeekStartField({
  id,
  value,
  onChange,
  locationId,
  disabled,
  invalid,
}: {
  id: string;
  // "YYYY-MM-DD", or "" while nothing is picked.
  value: string;
  onChange: (monday: string) => void;
  // No location yet (or edit mode): a plain calendar, nothing fetched.
  locationId: string | null;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() =>
    value ? toLocalDate(mondayOf(value)) : new Date(),
  );
  const [fetched, setFetched] = useState<Record<string, RequestedWeek[]>>({});

  const monthKey = toIso(month).slice(0, 7);
  const active = !disabled && locationId !== null;

  useEffect(() => {
    if (!active) return;
    const key = `${locationId}|${monthKey}`;
    const { from, to } = weekDayRange(toLocalDate(`${monthKey}-01`));
    let current = true;
    loadRequestedWeeks(locationId, from, to)
      .then((weeks) => {
        if (current) setFetched((prev) => ({ ...prev, [key]: weeks }));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, locationId, monthKey]);

  const marks = useMemo(() => {
    if (!active) return new Map<string, WeekMark>();
    const prefix = `${locationId}|`;
    return markedWeeks(
      Object.entries(fetched)
        .filter(([key]) => key.startsWith(prefix))
        .flatMap(([, weeks]) => weeks),
    );
  }, [active, locationId, fetched]);

  const [takenDays, fulfilledDays] = useMemo(() => {
    const mondaysWith = (mark: WeekMark) =>
      [...marks].filter(([, m]) => m === mark).map(([monday]) => monday);
    return [
      daysOfWeeks(mondaysWith("taken")),
      daysOfWeeks(mondaysWith("fulfilled")),
    ];
  }, [marks]);

  const monday = value ? mondayOf(value) : "";
  const noteId = `${id}-note`;
  const isAddition = monday !== "" && marks.get(monday) === "fulfilled";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              id={id}
              disabled={disabled}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={isAddition ? noteId : undefined}
              data-empty={monday === "" ? "true" : undefined}
              className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground"
            />
          }
        >
          <CalendarIcon aria-hidden />
          <span>{monday ? formatWeekStart(monday) : "Pick a week"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto">
          <Calendar
            mode="single"
            required
            weekStartsOn={1}
            month={month}
            onMonthChange={setMonth}
            selected={monday ? toLocalDate(monday) : undefined}
            onSelect={(date) => {
              onChange(mondayOf(toIso(date)));
              setOpen(false);
            }}
            disabled={takenDays}
            modifiers={{ taken: takenDays, fulfilled: fulfilledDays }}
            modifiersClassNames={MODIFIER_CLASS_NAMES}
            classNames={{ disabled: "text-muted-foreground" }}
            labels={{
              labelDayButton: (date) =>
                dayAriaLabel(date, marks.get(mondayOf(toIso(date)))),
            }}
          />
          {active ? (
            <ul className="flex flex-col gap-1.5 border-t px-2 pt-2 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-foreground"
                />
                Week already has a request, unavailable
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full border border-foreground"
                />
                Fulfilled only, a new request is an addition
              </li>
            </ul>
          ) : null}
        </PopoverContent>
      </Popover>
      {isAddition ? (
        <FieldDescription id={noteId}>
          This week already has a fulfilled request. A new request is treated as
          an addition.
        </FieldDescription>
      ) : null}
    </>
  );
}
