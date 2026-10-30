// Read-only list of a week's daily fills, shown where the weekly grid would
// be when the week has no weekly plan (a daily request can be filled without
// one). Presentational only: the page resolves names and labels server-side.

export type DailyFillView = {
  date: string;
  workAreaName: string;
  shiftLabel: string;
  employeeId: string;
  name: string;
};

export function DailyFillsList({ fills }: { fills: DailyFillView[] }) {
  const byDate = new Map<string, DailyFillView[]>();
  for (const fill of fills) {
    const list = byDate.get(fill.date);
    if (list) list.push(fill);
    else byDate.set(fill.date, [fill]);
  }

  return (
    <section aria-label="Daily fills" className="flex min-w-0 flex-col gap-4">
      <h2 className="text-xs font-semibold text-muted-foreground">Daily fills</h2>
      {[...byDate.entries()].map(([date, list]) => (
        <div key={date} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium tabular-nums">{date}</h3>
          <ul className="divide-y rounded-lg border">
            {list.map((fill) => (
              <li
                key={`${fill.workAreaName}|${fill.shiftLabel}|${fill.employeeId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <span>
                  {fill.workAreaName} · {fill.shiftLabel}
                </span>
                <span className="text-muted-foreground">
                  <span className="font-mono text-xs tabular-nums">{fill.employeeId}</span>{" "}
                  {fill.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
