"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";

import {
  CalendarLegend,
  MODIFIER_CLASS_NAMES,
} from "@/app/dashboard/requests/request-calendar-marks";
import { useRequestMarks } from "@/app/dashboard/requests/use-request-marks";
import {
  calendarDayAriaLabel,
  formatDay,
  toIso,
  toLocalDate,
} from "@/app/dashboard/requests/week-calendar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { mondayOf } from "@/lib/dates";

// The roster's week navigator: a Monday-start calendar that shows which weeks
// and days of the chosen location already hold a request. Nothing is
// unavailable here, the marks only tell the admin where to look. Picking any
// day hands it to onChange, which snaps to that week's Monday.
export function RosterWeekPicker({
  week,
  locationId,
  onChange,
}: {
  // The Monday of the week on show.
  week: string;
  // The location the roster resolved; null (none in scope) leaves it unmarked.
  locationId: string | null;
  onChange: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => toLocalDate(week));
  const { weekMarks, dailyDates, takenDays, fulfilledDays, dailyDays } =
    useRequestMarks(locationId, true, month);

  const text = formatDay(week);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Reopening starts on the month of the week on show, not wherever the
        // last browse ended.
        if (next) setMonth(toLocalDate(week));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={`Week start, ${text}`}
            className="w-44 justify-start font-normal max-sm:h-10"
          />
        }
      >
        <CalendarIcon aria-hidden />
        <span>{text}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <Calendar
          mode="single"
          required
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={toLocalDate(week)}
          onSelect={(date) => {
            onChange(toIso(date));
            setOpen(false);
          }}
          modifiers={{
            taken: takenDays,
            fulfilled: fulfilledDays,
            daily: dailyDays,
          }}
          modifiersClassNames={MODIFIER_CLASS_NAMES}
          labels={{
            labelDayButton: (date) => {
              const iso = toIso(date);
              return calendarDayAriaLabel(date, {
                weekMark: weekMarks.get(mondayOf(iso)),
                hasDaily: dailyDates.has(iso),
                blocks: null,
              });
            },
          }}
        />
        {locationId !== null ? <CalendarLegend blocks={null} /> : null}
      </PopoverContent>
    </Popover>
  );
}
