import { asc, eq } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isFutureDate, todayIn } from "@/lib/dates";
import { loadDayData } from "@/lib/attendance-data";
import {
  attendanceLocationWhere,
  writableLocationId,
} from "@/lib/attendance-scope";
import { selectedLocationFor } from "@/app/dashboard/roster/roster-location";
import { attendanceDateSchema } from "@/validation/attendance";
import { AttendanceDayView } from "@/app/dashboard/attendance/attendance-day-view";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Deliberate block: the page queries attendance data behind the session
// check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Single-string URL params with a whitelist, like the roster page: only
// well-formed values reach the queries, anything else parses to null.
function whitelistParam(
  raw: Record<string, string | string[] | undefined>,
  key: string,
  test: (value: string) => boolean,
): string | null {
  const value = raw[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single && test(single) ? single : null;
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: string): boolean =>
  attendanceDateSchema.safeParse(value).success;

function NoLocation() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="page-title" tabIndex={-1} data-focus-fallback>
        Attendance
      </h1>
      <Alert>
        <AlertDescription>
          No location is available for your account. Ask an administrator to
          bind your account to a location or a site.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// The day page: read path only. The admin of a location gets the write
// controls, ho and superadmin see the same list read-only (the actions
// refuse them server-side whatever the page shows). "Today" and the
// future-date flag come from the selected location's own time zone, never
// from the browser.
export default async function AttendancePage({
  searchParams,
}: PageProps<"/dashboard/attendance">) {
  const actor = await requireUser();
  const raw = await searchParams;
  const now = new Date();

  // The live locations the actor may open (name-ordered, site first).
  const locations = await db
    .select({
      id: siteLocation.id,
      name: siteLocation.name,
      siteId: siteLocation.siteId,
      siteName: site.name,
      timezone: siteLocation.timezone,
    })
    .from(siteLocation)
    .innerJoin(site, eq(siteLocation.siteId, site.id))
    .where(attendanceLocationWhere(actor))
    .orderBy(asc(site.name), asc(siteLocation.name));

  // An admin's binding always wins; otherwise the URL pick when it is in
  // scope, else the first location. A binding to a location that is gone
  // matches nothing in the list, so it lands on the empty state.
  const locationId = selectedLocationFor({
    pinnedLocationId: actor.role === "admin" ? actor.siteLocationId : null,
    siteLocations: locations,
    param: whitelistParam(raw, "location", isUuid),
    planLocationId: null,
  });
  const selected = locations.find((l) => l.id === locationId);
  if (!selected) return <NoLocation />;

  const date =
    whitelistParam(raw, "date", isDate) ?? todayIn(selected.timezone, now);
  const data = await loadDayData(selected.id, date);

  // A filter only holds when it names a shift or area of this location.
  const shiftParam = whitelistParam(raw, "shift", isUuid);
  const areaParam = whitelistParam(raw, "area", isUuid);
  const shiftId = data.shifts.some((s) => s.id === shiftParam)
    ? shiftParam
    : null;
  const areaId = data.areas.some((a) => a.id === areaParam) ? areaParam : null;

  return (
    <AttendanceDayView
      date={date}
      canWrite={writableLocationId(actor) === selected.id}
      future={isFutureDate(date, selected.timezone, now)}
      locationOptions={locations.map((l) => ({
        id: l.id,
        label: actor.role === "superadmin" ? `${l.siteName} / ${l.name}` : l.name,
      }))}
      locationId={selected.id}
      data={data}
      shiftId={shiftId}
      areaId={areaId}
    />
  );
}
