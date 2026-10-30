"use client";

import { useState } from "react";
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

import { CalendarLegend, MODIFIER_CLASS_NAMES } from "./request-calendar-marks";
import { useRequestMarks } from "./use-request-marks";
import {
  calendarDayAriaLabel,
  formatDay,
  toIso,
  toLocalDate,
} from "./week-calendar";

// The weekly create form's "Week start": a Monday-start calendar that marks
// the weeks the chosen location already has a live request for and, for
// context, the days holding an open daily one. Picking any day stores that
// week's Monday. Markers come from useRequestMarks, fetched per visible month
// and keyed by location.
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
  const active = !disabled && locationId !== null;
  const { weekMarks, dailyDates, takenDays, fulfilledDays, dailyDays } =
    useRequestMarks(locationId, !disabled, month);

  const monday = value ? mondayOf(value) : "";
  const noteId = `${id}-note`;
  const isAddition = monday !== "" && weekMarks.get(monday) === "fulfilled";

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
          <span>{monday ? formatDay(monday) : "Pick a week"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <Calendar
            className="w-full"
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
            modifiers={{
              taken: takenDays,
              fulfilled: fulfilledDays,
              daily: dailyDays,
            }}
            modifiersClassNames={MODIFIER_CLASS_NAMES}
            classNames={{ disabled: "text-muted-foreground" }}
            labels={{
              labelDayButton: (date) => {
                const iso = toIso(date);
                return calendarDayAriaLabel(date, {
                  weekMark: weekMarks.get(mondayOf(iso)),
                  hasDaily: dailyDates.has(iso),
                  blocks: "week",
                });
              },
            }}
          />
          {active ? <CalendarLegend blocks="week" /> : null}
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
