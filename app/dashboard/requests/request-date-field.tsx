"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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

// The daily create form's "Request date": a Monday-start calendar that marks
// the days the chosen location already has an open daily request for (those
// cannot take a second one, the DB slot, so they are disabled) and, for
// context, the weeks holding a weekly request (a daily request is an exception
// on top of a weekly plan, so those days stay pickable). Markers come from
// useRequestMarks, fetched per visible month and keyed by location.
export function RequestDateField({
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
  onChange: (date: string) => void;
  // No location yet (or edit mode): a plain calendar, nothing fetched.
  locationId: string | null;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() =>
    value ? toLocalDate(value) : new Date(),
  );
  const active = !disabled && locationId !== null;
  const { weekMarks, dailyDates, takenDays, fulfilledDays, dailyDays } =
    useRequestMarks(locationId, !disabled, month);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
            disabled={disabled}
            aria-invalid={invalid ? true : undefined}
            data-empty={value === "" ? "true" : undefined}
            className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground"
          />
        }
      >
        <CalendarIcon aria-hidden />
        <span>{value ? formatDay(value) : "Pick a date"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Calendar
          className="w-full"
          mode="single"
          required
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={value ? toLocalDate(value) : undefined}
          onSelect={(date) => {
            onChange(toIso(date));
            setOpen(false);
          }}
          disabled={dailyDays}
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
                blocks: "day",
              });
            },
          }}
        />
        {active ? <CalendarLegend blocks="day" /> : null}
      </PopoverContent>
    </Popover>
  );
}
