import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";

import {
  mpRequest,
  mpRequestLine,
  position,
  shiftDefinition,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { mpRequestMutationWhere } from "@/lib/mp-request-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequestFormPage } from "@/app/dashboard/requests/request-form";
import type {
  MpRequestGridPosition,
  MpRequestGridShift,
  MpRequestGridWorkArea,
} from "@/types/mp-request";

// Deliberate block: the page queries request data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// The row-actions edit dialog moved to a full page (#129): same guards, the
// same data the list page used to feed the dialog, now fetched server-side
// for this one row.
export default async function EditRequestPage({
  params,
}: PageProps<"/dashboard/requests/[id]/edit">) {
  const { id } = await params;
  // A malformed id is a missing page, not a server error.
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await requireUser();
  // mpRequestMutationWhere matches per site, so it does NOT block an ho on
  // its own — the write surface is admin + superadmin only (spec §3.3).
  if (actor.role === "ho") notFound();

  const [row] = await db
    .select({
      id: mpRequest.id,
      type: mpRequest.type,
      status: mpRequest.status,
      weekStart: mpRequest.weekStart,
      requestDate: mpRequest.requestDate,
      siteLocationId: mpRequest.siteLocationId,
    })
    .from(mpRequest)
    // Only editable requests resolve to a page; anything else is 404 —
    // the actor must also be in scope for this row.
    .where(
      and(mpRequestMutationWhere(actor, id), eq(mpRequest.status, "submitted")),
    )
    .limit(1);
  if (!row) notFound();

  const [lineRows, activeWorkAreaRows, activeShifts, areaPositionRows] =
    await Promise.all([
    // Names joined even for pairs that have since left the active masters:
    // the form renders those lines as removable inactive pairs.
    db
      .select({
        requestId: mpRequestLine.requestId,
        workAreaId: mpRequestLine.workAreaId,
        workAreaName: workArea.name,
        shiftDefinitionId: mpRequestLine.shiftDefinitionId,
        shiftLabel: shiftDefinition.label,
        positionId: mpRequestLine.positionId,
        positionName: position.name,
        date: mpRequestLine.date,
        headcount: mpRequestLine.headcount,
      })
      .from(mpRequestLine)
      .innerJoin(workArea, eq(mpRequestLine.workAreaId, workArea.id))
      .innerJoin(
        shiftDefinition,
        eq(mpRequestLine.shiftDefinitionId, shiftDefinition.id),
      )
      .innerJoin(position, eq(mpRequestLine.positionId, position.id))
      .where(eq(mpRequestLine.requestId, row.id)),
    // This row's active masters only — the location is immutable here, so
    // there is no site/location pick to serve options for.
    db
      .select({
        id: workArea.id,
        name: workArea.name,
        siteLocationId: workArea.siteLocationId,
      })
      .from(workArea)
      .where(
        and(
          eq(workArea.isActive, true),
          isNull(workArea.deletedAt),
          eq(workArea.siteLocationId, row.siteLocationId),
        ),
      )
      .orderBy(asc(workArea.name)),
    db
      .select({
        id: shiftDefinition.id,
        label: shiftDefinition.label,
        siteLocationId: shiftDefinition.siteLocationId,
        orderIndex: shiftDefinition.orderIndex,
        startTime: shiftDefinition.startTime,
        endTime: shiftDefinition.endTime,
      })
      .from(shiftDefinition)
      .where(
        and(
          eq(shiftDefinition.isActive, true),
          isNull(shiftDefinition.deletedAt),
          eq(shiftDefinition.siteLocationId, row.siteLocationId),
        ),
      )
      .orderBy(asc(shiftDefinition.orderIndex)),
    // This row's location's required positions per area (live + active,
    // name-ascending) — the grid rows are area × shift × required
    // position (#137).
    db
      .select({
        workAreaId: workAreaPosition.workAreaId,
        positionId: position.id,
        positionName: position.name,
      })
      .from(workAreaPosition)
      .innerJoin(position, eq(workAreaPosition.positionId, position.id))
      .where(
        and(
          eq(position.isActive, true),
          isNull(position.deletedAt),
          eq(workAreaPosition.siteLocationId, row.siteLocationId),
        ),
      )
      .orderBy(asc(position.name)),
  ]);

  // Group the pivot rows onto their area masters (order preserved).
  const positionsByWorkArea = new Map<string, MpRequestGridPosition[]>();
  for (const areaPosition of areaPositionRows) {
    const list = positionsByWorkArea.get(areaPosition.workAreaId) ?? [];
    list.push({ id: areaPosition.positionId, name: areaPosition.positionName });
    positionsByWorkArea.set(areaPosition.workAreaId, list);
  }
  const activeWorkAreas: MpRequestGridWorkArea[] = activeWorkAreaRows.map(
    (area) => ({
      ...area,
      positions: positionsByWorkArea.get(area.id) ?? [],
    }),
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          nativeButton={false}
          render={<Link href="/dashboard/requests" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to requests
        </Button>
        <h1 className="page-title">
          Edit request lines
        </h1>
        <p className="text-sm text-muted-foreground">
          The anchor (week or date) is fixed after creation; edit the
          headcounts within it.
        </p>
      </div>
      <Card>
        <CardContent>
          <RequestFormPage
            type={row.type}
            siteLocationId={row.siteLocationId}
            siteLocations={[]}
            sites={[]}
            activeWorkAreas={activeWorkAreas satisfies MpRequestGridWorkArea[]}
            activeShifts={activeShifts satisfies MpRequestGridShift[]}
            request={{
              id: row.id,
              type: row.type,
              status: row.status,
              weekStart: row.weekStart,
              requestDate: row.requestDate,
              lines: lineRows,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
