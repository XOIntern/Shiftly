import {
  DAYS,
  RequestGridShell,
} from "@/app/dashboard/requests/request-grid-shell";

// The per-day and week totals under the area sections, in the same column
// grid so the sums sit under their days.
export function TotalsRow({
  dates,
  totals,
  weekTotal,
  weekly,
}: {
  dates: string[];
  totals: number[];
  weekTotal: number;
  weekly: boolean;
}) {
  return (
    <RequestGridShell
      dates={dates}
      tail={weekly}
      className="rounded-md border bg-muted/40"
      tableClassName="tabular-nums"
    >
      <tbody>
        <tr>
          <th
            scope="row"
            className="sticky left-0 z-1 bg-muted px-3 py-2 text-start font-medium"
          >
            Total
          </th>
          {totals.map((count, i) => (
            <td key={dates[i]} className="px-1 py-2 text-center font-medium">
              {weekly ? <span className="sr-only">{`${DAYS[i]} `}</span> : null}
              {count}
            </td>
          ))}
          {weekly ? (
            <td className="px-2 py-2 font-semibold">
              <span className="sr-only">Week total </span>
              {weekTotal}
            </td>
          ) : null}
        </tr>
      </tbody>
    </RequestGridShell>
  );
}
