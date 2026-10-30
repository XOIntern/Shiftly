import type { CalendarBlocks } from "./week-calendar";

// The one set of request marks every calendar shares (the weekly form, the
// daily form, the roster week picker). Marker styling lives on the day cell (it
// already carries `relative`) and every state has its own shape, so none rests
// on colour: a week with an open or approved request is shaded with a filled
// dot under each day, a fulfilled week gets an outlined dot, and a day holding
// an open daily request gets a diamond in its corner, a fulfilled one an
// outlined diamond (that day can still take a new request).
const DOT =
  "after:absolute after:bottom-0 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full";

export const MODIFIER_CLASS_NAMES = {
  taken: `bg-muted rounded-none first:rounded-l-(--cell-radius) last:rounded-r-(--cell-radius) ${DOT} after:bg-foreground`,
  fulfilled: `${DOT} after:border after:border-foreground`,
  daily:
    "before:absolute before:top-1 before:right-1 before:size-1.5 before:rotate-45 before:bg-foreground",
  // Follows the text colour: a fulfilled day stays pickable, so it can sit
  // under the selected day's fill, where a foreground-coloured mark vanishes.
  dailyFulfilled:
    "before:absolute before:top-1 before:right-1 before:size-1.5 before:rotate-45 before:border before:border-current",
};

// `blocks` is what the calendar refuses to let the user pick; only that entry
// says "unavailable" (or, for a fulfilled week, that a new request is an
// addition), the rest just say what they mark.
export function CalendarLegend({ blocks }: { blocks: CalendarBlocks }) {
  const entries = [
    {
      key: "taken",
      label:
        blocks === "week"
          ? "Week already has a request, unavailable"
          : "Week has an open or approved request",
      shape: "size-2 rounded-full bg-foreground",
    },
    {
      key: "fulfilled",
      label:
        blocks === "week"
          ? "Fulfilled only, a new request is an addition"
          : "Week has a fulfilled request",
      shape: "size-2 rounded-full border border-foreground",
    },
    {
      key: "daily",
      label:
        blocks === "day"
          ? "Day already has a request, unavailable"
          : "Day has an open daily request",
      shape: "size-1.5 rotate-45 bg-foreground",
    },
    {
      key: "dailyFulfilled",
      label: "Day has a fulfilled daily request",
      shape: "size-1.5 rotate-45 border border-foreground",
    },
  ];

  return (
    <ul className="flex flex-col gap-1.5 border-t px-2 pt-2 text-xs text-muted-foreground">
      {entries.map(({ key, label, shape }) => (
        <li key={key} className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-2 shrink-0 items-center justify-center"
          >
            <span className={shape} />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
