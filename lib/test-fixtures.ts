import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "./db";
import type { Cleanup } from "./test-cleanup";
import type { AttendanceStatus } from "../types/attendance";
import type { LocationTimezone } from "../types/timezone";
import {
  attendanceRecord,
  auditLog,
  mpRequest,
  mpRequestLine,
  position,
  rosterAssignment,
  rosterPlan,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "../drizzle/schema";

// Seeders for db-backed suites. Each one registers its own teardown on the
// given Cleanup right after inserting, and teardowns run last-registered
// first, so a row seeded on top of another is removed before the row it
// depends on. A seeder handed rows the CALLER registered (a worker on a
// location from seedLocation) relies on that order: seed the dependency
// first. Teardowns match zero rows when something else (a purge under test)
// already deleted them.

type Loc = { id: string; siteId: string };

const MONDAY = "2026-01-05";

// Recognisable as test data, unique per call so repeated and parallel runs
// never collide on the partial unique indexes.
function unique(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function deletedAt(deleted: boolean | undefined): Date | null {
  return deleted ? new Date() : null;
}

export async function seedSite(
  cleanup: Cleanup,
  opts: { deleted?: boolean; name?: string } = {},
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = opts.name ?? unique("t-fx-site");
  cleanup.defer(async () => {
    await db.delete(site).where(eq(site.id, id));
  });
  await db
    .insert(site)
    .values({ id, name, deletedAt: deletedAt(opts.deleted) });
  return { id, name };
}

export async function seedLocation(
  cleanup: Cleanup,
  siteId: string,
  opts: { deleted?: boolean; name?: string; timezone?: LocationTimezone } = {},
): Promise<{ id: string; siteId: string; name: string }> {
  const id = randomUUID();
  const name = opts.name ?? unique("t-fx-loc");
  cleanup.defer(async () => {
    await db.delete(siteLocation).where(eq(siteLocation.id, id));
  });
  await db.insert(siteLocation).values({
    id,
    siteId,
    name,
    timezone: opts.timezone,
    deletedAt: deletedAt(opts.deleted),
  });
  return { id, siteId, name };
}

export async function seedPosition(
  cleanup: Cleanup,
  siteId: string,
  opts: { deleted?: boolean; name?: string } = {},
): Promise<{ id: string; siteId: string; name: string }> {
  const id = randomUUID();
  const name = opts.name ?? unique("t-fx-position");
  cleanup.defer(async () => {
    await db.delete(workAreaPosition).where(eq(workAreaPosition.positionId, id));
    await db.delete(workerPosition).where(eq(workerPosition.positionId, id));
    await db.delete(position).where(eq(position.id, id));
  });
  await db
    .insert(position)
    .values({ id, siteId, name, deletedAt: deletedAt(opts.deleted) });
  return { id, siteId, name };
}

export async function seedWorkArea(
  cleanup: Cleanup,
  loc: Loc,
  opts: { positionIds?: string[]; deleted?: boolean; name?: string } = {},
): Promise<{
  id: string;
  siteId: string;
  siteLocationId: string;
  name: string;
  positionIds: string[];
}> {
  const id = randomUUID();
  const name = opts.name ?? unique("t-fx-area");
  const positionIds = opts.positionIds ?? [];
  cleanup.defer(async () => {
    await db.delete(workAreaPosition).where(eq(workAreaPosition.workAreaId, id));
    await db.delete(workArea).where(eq(workArea.id, id));
  });
  await db.insert(workArea).values({
    id,
    siteLocationId: loc.id,
    siteId: loc.siteId,
    name,
    deletedAt: deletedAt(opts.deleted),
  });
  if (positionIds.length > 0) {
    await db.insert(workAreaPosition).values(
      positionIds.map((positionId) => ({
        workAreaId: id,
        positionId,
        siteId: loc.siteId,
        siteLocationId: loc.id,
      })),
    );
  }
  return { id, siteId: loc.siteId, siteLocationId: loc.id, name, positionIds };
}

export async function seedShift(
  cleanup: Cleanup,
  loc: Loc,
  opts: { orderIndex?: number; deleted?: boolean } = {},
): Promise<{
  id: string;
  siteId: string;
  siteLocationId: string;
  label: string;
  orderIndex: number;
}> {
  const id = randomUUID();
  const label = unique("t-fx-shift");
  const orderIndex = opts.orderIndex ?? 1;
  cleanup.defer(async () => {
    await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
  });
  await db.insert(shiftDefinition).values({
    id,
    siteLocationId: loc.id,
    siteId: loc.siteId,
    label,
    orderIndex,
    startTime: "06:00",
    endTime: "14:00",
    deletedAt: deletedAt(opts.deleted),
  });
  return { id, siteId: loc.siteId, siteLocationId: loc.id, label, orderIndex };
}

export async function seedWorker(
  cleanup: Cleanup,
  loc: Loc,
  opts: {
    positionIds?: string[];
    deleted?: boolean;
    name?: string;
    employeeId?: string;
  } = {},
): Promise<{
  id: string;
  siteId: string;
  siteLocationId: string;
  employeeId: string;
  name: string;
  positionIds: string[];
}> {
  const id = randomUUID();
  const name = opts.name ?? unique("t-fx-worker");
  const employeeId = opts.employeeId ?? unique("EMP");
  const positionIds = opts.positionIds ?? [];
  cleanup.defer(async () => {
    await db.delete(workerPosition).where(eq(workerPosition.workerId, id));
    await db.delete(worker).where(eq(worker.id, id));
  });
  await db.insert(worker).values({
    id,
    siteLocationId: loc.id,
    siteId: loc.siteId,
    employeeId,
    name,
    deletedAt: deletedAt(opts.deleted),
  });
  if (positionIds.length > 0) {
    await db.insert(workerPosition).values(
      positionIds.map((positionId) => ({
        workerId: id,
        positionId,
        siteId: loc.siteId,
      })),
    );
  }
  return {
    id,
    siteId: loc.siteId,
    siteLocationId: loc.id,
    employeeId,
    name,
    positionIds,
  };
}

export async function seedUser(
  cleanup: Cleanup,
  opts: {
    role: "ho" | "admin" | "superadmin";
    siteId?: string;
    siteLocationId?: string;
    deleted?: boolean;
    email?: string;
  },
): Promise<{
  id: string;
  name: string;
  email: string;
  role: "ho" | "admin" | "superadmin";
  siteId: string | null;
  siteLocationId: string | null;
}> {
  const id = randomUUID();
  const name = `Fixture ${opts.role} ${id.slice(0, 8)}`;
  const email = opts.email ?? `t-fx-${id}@shiftly.test`;
  const siteId = opts.siteId ?? null;
  const siteLocationId = opts.siteLocationId ?? null;
  cleanup.defer(async () => {
    await db.delete(user).where(eq(user.id, id));
  });
  await db.insert(user).values({
    id,
    name,
    email,
    emailVerified: true,
    role: opts.role,
    siteId,
    siteLocationId,
    deletedAt: deletedAt(opts.deleted),
  });
  return { id, name, email, role: opts.role, siteId, siteLocationId };
}

// History rows. Seed them after the entities they reference so their
// teardowns run before those entities are removed.

// A weekly draft on the first Monday unless told otherwise. `requestDate`
// makes it a daily plan; `weekStart` moves a weekly one.
export async function seedRosterPlan(
  cleanup: Cleanup,
  loc: Loc,
  opts: {
    generatedBy?: string;
    publishedBy?: string;
    status?: "draft" | "published";
    version?: number;
    weekStart?: string;
    requestDate?: string;
  } = {},
): Promise<{ id: string }> {
  const id = randomUUID();
  cleanup.defer(async () => {
    await db.delete(rosterPlan).where(eq(rosterPlan.id, id));
  });
  const anchor = opts.requestDate
    ? { kind: "daily" as const, requestDate: opts.requestDate, weekStart: null }
    : { kind: "weekly" as const, weekStart: opts.weekStart ?? MONDAY };
  await db.insert(rosterPlan).values({
    id,
    siteLocationId: loc.id,
    siteId: loc.siteId,
    ...anchor,
    status: opts.status,
    version: opts.version,
    rulesSnapshot: {},
    generatedBy: opts.generatedBy,
    publishedBy: opts.publishedBy,
  });
  return { id };
}

export async function seedMpRequest(
  cleanup: Cleanup,
  loc: Loc,
  opts: {
    createdBy: string;
    status?: "open" | "approved" | "fulfilled" | "rejected" | "withdrawn";
    type?: "weekly" | "daily";
    weekStart?: string;
    requestDate?: string;
    createdAt?: Date;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  cleanup.defer(async () => {
    await db.delete(mpRequest).where(eq(mpRequest.id, id));
  });
  const anchor =
    opts.type === "daily"
      ? {
          type: "daily" as const,
          requestDate: opts.requestDate ?? MONDAY,
          weekStart: null,
        }
      : { type: "weekly" as const, weekStart: opts.weekStart ?? MONDAY };
  await db.insert(mpRequest).values({
    id,
    siteLocationId: loc.id,
    siteId: loc.siteId,
    ...anchor,
    status: opts.status,
    createdBy: opts.createdBy,
    createdAt: opts.createdAt,
  });
  return { id };
}

export async function seedAuditLog(
  cleanup: Cleanup,
  opts: { actorId: string; siteId?: string; siteLocationId?: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  cleanup.defer(async () => {
    await db.delete(auditLog).where(eq(auditLog.id, id));
  });
  await db.insert(auditLog).values({
    id,
    actorId: opts.actorId,
    action: "test.fixture",
    siteId: opts.siteId,
    siteLocationId: opts.siteLocationId,
    details: {},
  });
  return { id };
}

export async function seedAssignment(
  cleanup: Cleanup,
  opts: {
    planId: string;
    loc: Loc;
    workerId: string;
    workAreaId: string;
    shiftId: string;
    date?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  cleanup.defer(async () => {
    await db.delete(rosterAssignment).where(eq(rosterAssignment.id, id));
  });
  await db.insert(rosterAssignment).values({
    id,
    planId: opts.planId,
    siteLocationId: opts.loc.id,
    siteId: opts.loc.siteId,
    workerId: opts.workerId,
    workAreaId: opts.workAreaId,
    shiftDefinitionId: opts.shiftId,
    date: opts.date ?? MONDAY,
  });
  return { id };
}

// The rostered shift defaults to the worked shift, except for an unscheduled
// row (withoutRoster), which has none.
export async function seedAttendance(
  cleanup: Cleanup,
  opts: {
    loc: Loc;
    workerId: string;
    workAreaId: string;
    shiftId: string;
    recordedBy: string;
    date?: string;
    status?: AttendanceStatus;
    withoutRoster?: boolean;
    rosteredShiftId?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  const withoutRoster = opts.withoutRoster ?? false;
  cleanup.defer(async () => {
    await db.delete(attendanceRecord).where(eq(attendanceRecord.id, id));
  });
  await db.insert(attendanceRecord).values({
    id,
    siteLocationId: opts.loc.id,
    siteId: opts.loc.siteId,
    workerId: opts.workerId,
    date: opts.date ?? MONDAY,
    shiftDefinitionId: opts.shiftId,
    workAreaId: opts.workAreaId,
    status: opts.status ?? "present",
    withoutRoster,
    rosteredShiftDefinitionId: withoutRoster
      ? null
      : (opts.rosteredShiftId ?? opts.shiftId),
    recordedBy: opts.recordedBy,
  });
  return { id };
}

// The work area must already be linked to the position (seedWorkArea with
// positionIds): the line is welded to that pivot row.
export async function seedRequestLine(
  cleanup: Cleanup,
  opts: {
    requestId: string;
    loc: Loc;
    workAreaId: string;
    shiftId: string;
    positionId: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  cleanup.defer(async () => {
    await db.delete(mpRequestLine).where(eq(mpRequestLine.id, id));
  });
  await db.insert(mpRequestLine).values({
    id,
    requestId: opts.requestId,
    siteLocationId: opts.loc.id,
    siteId: opts.loc.siteId,
    workAreaId: opts.workAreaId,
    shiftDefinitionId: opts.shiftId,
    positionId: opts.positionId,
    date: MONDAY,
    headcount: 1,
  });
  return { id };
}
