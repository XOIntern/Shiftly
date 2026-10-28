import type { ReactNode } from "react";
import { cn } from "cn";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Fixed column widths shared by every section table and the totals table,
// so the day columns line up down the whole form.
const NAME_COL = "w-44";
const DAY_COL = "w-16";
const TAIL_COL = "w-32";

// The row label column stays put while the day columns scroll sideways on
// narrow screens.
export const STICKY_CELL = "sticky left-0 z-[1] bg-card";

function GridColumns({ dates, tail }: { dates: string[]; tail: boolean }) {
  return (
    <colgroup>
      <col className={NAME_COL} />
      {dates.map((date) => (
        <col key={date} className={DAY_COL} />
      ))}
      {tail ? <col className={TAIL_COL} /> : null}
    </colgroup>
  );
}

export function DayHeaders({ type }: { type: "weekly" | "daily" }) {
  return type === "weekly" ? (
    <>
      {DAYS.map((day) => (
        <th key={day} scope="col" className="px-1 py-2 text-center font-medium">
          {day}
        </th>
      ))}
    </>
  ) : (
    <th scope="col" className="px-1 py-2 text-center font-medium">
      Headcount
    </th>
  );
}

// The sideways-scrolling, fixed-layout table every grid block of the form
// sits in: the area sections, the inactive lines and the totals. `tail` adds
// the weekly "same all days" / week-total column; `footer` renders inside
// the scroll container, under the table.
export function RequestGridShell({
  dates,
  tail,
  id,
  hidden,
  className,
  tableClassName,
  footer,
  children,
}: {
  dates: string[];
  tail: boolean;
  id?: string;
  hidden?: boolean;
  className?: string;
  tableClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      hidden={hidden}
      className={cn("relative overflow-x-auto", className)}
    >
      <table
        className={cn(
          "w-max min-w-full table-fixed border-collapse text-sm",
          tableClassName,
        )}
      >
        <GridColumns dates={dates} tail={tail} />
        {children}
      </table>
      {footer}
    </div>
  );
}
