import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import {
  position,
  shiftDefinition,
  site,
  siteLocation,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequestFormPage } from "@/app/dashboard/requests/request-form";
import type {
  MpRequestGridPosition,
  MpRequestGridWorkArea,
} from "@/types/mp-request";
import type { SiteLocationOption, SiteOption } from "@/types/site";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// The create dialog moved to a full page (#128): same masters the dialog
// was fed, same role narrowing, only the canWrite ternaries are gone —
// an ho actor never reaches the fetches (notFound above).
export default async function NewRequestPage() {
  const actor = await requireUser();
  // Write surface is admin + superadmin only (spec §3.3).
  if (actor.role === "ho") notFound();
  const isSuperadmin = actor.role === "superadmin";

  const [siteLocations, sites, activeWorkAreaRows, activeShifts, areaPositionRows] =
    await Promise.all([
      actor.role === "admin"
        ? actor.siteLocationId
          ? db
              .select({
                id: siteLocation.id,
                name: siteLocation.name,
                siteId: siteLocation.siteId,
              })
              .from(siteLocation)
              .where(
                and(
                  eq(siteLocation.id, actor.siteLocationId),
                  isNull(siteLocation.deletedAt),
                ),
              )
              .orderBy(asc(siteLocation.name))
          : Promise.resolve([])
        : db
            .select({
              id: siteLocation.id,
              name: siteLocation.name,
              siteId: siteLocation.siteId,
            })
            .from(siteLocation)
            .where(isNull(siteLocation.deletedAt))
            .orderBy(asc(siteLocation.name)),
      actor.role === "admin"
        ? actor.siteLocationId
          ? db
              .selectDistinct({ id: site.id, name: site.name })
              .from(site)
              .innerJoin(siteLocation, eq(site.id, siteLocation.siteId))
              .where(
                and(
                  eq(siteLocation.id, actor.siteLocationId),
                  isNull(site.deletedAt),
                ),
              )
              .orderBy(asc(site.name))
          : Promise.resolve([])
        : db
            .select({ id: site.id, name: site.name })
            .from(site)
            .where(isNull(site.deletedAt))
            .orderBy(asc(site.name)),
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
            ...(actor.role === "admin" && actor.siteLocationId
              ? [eq(workArea.siteLocationId, actor.siteLocationId)]
              : isSuperadmin
                ? []
                : []),
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
            ...(actor.role === "admin" && actor.siteLocationId
              ? [eq(shiftDefinition.siteLocationId, actor.siteLocationId)]
              : isSuperadmin
                ? []
                : []),
          ),
        )
        .orderBy(asc(shiftDefinition.orderIndex)),
      // Each area's required positions (live + active, name-ascending) —
      // the grid rows are area × shift × required position (#137). Same
      // role scope as the sibling master queries.
      actor.role === "admin"
        ? actor.siteLocationId
          ? db
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
                  eq(workAreaPosition.siteLocationId, actor.siteLocationId),
                ),
              )
              .orderBy(asc(position.name))
          : Promise.resolve([])
        : db
            .select({
              workAreaId: workAreaPosition.workAreaId,
              positionId: position.id,
              positionName: position.name,
            })
            .from(workAreaPosition)
            .innerJoin(position, eq(workAreaPosition.positionId, position.id))
            .where(
              and(eq(position.isActive, true), isNull(position.deletedAt)),
            )
            .orderBy(asc(position.name)),
    ]);

  // Group the pivot rows onto their area masters (order preserved).
  const positionsByWorkArea = new Map<string, MpRequestGridPosition[]>();
  for (const row of areaPositionRows) {
    const list = positionsByWorkArea.get(row.workAreaId) ?? [];
    list.push({ id: row.positionId, name: row.positionName });
    positionsByWorkArea.set(row.workAreaId, list);
  }
  const activeWorkAreas: MpRequestGridWorkArea[] = activeWorkAreaRows.map(
    (area) => ({
      ...area,
      positions: positionsByWorkArea.get(area.id) ?? [],
    }),
  );

  const pinnedLocationName =
    actor.role === "admin" ? (siteLocations[0]?.name ?? undefined) : undefined;

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
        <h1 className="text-2xl font-semibold tracking-tight">New request</h1>
        <p className="text-sm text-muted-foreground">
          Weekly requests anchor on a Monday and carry one line per work
          area, shift and day; daily requests target a single date.
        </p>
      </div>
      <Card>
        <CardContent>
          <RequestFormPage
            type="weekly"
            siteLocations={siteLocations satisfies SiteLocationOption[]}
            sites={sites satisfies SiteOption[]}
            activeWorkAreas={activeWorkAreas}
            activeShifts={activeShifts}
            pinnedLocationName={pinnedLocationName}
            siteLocationId={
              pinnedLocationName !== undefined
                ? siteLocations[0]?.id
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
