import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
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
  worker,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import type {
  MpRequestCreateInput,
  MpRequestLineInput,
} from "@/validation/request-line";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The request actions resolve their actor through requireUser — swapped
// for a stub so the real server actions read against the test database.
// The mock swaps the WHOLE module across bun's single test process, so every
// export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

// A known Monday (week anchor for the weekly fixtures).
const MONDAY = "2026-03-02";

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: `t-mp-${randomUUID()}`,
    name: "T-MP Actor",
    email: `t-mp-act-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// The actor's id lands on mp_request.created_by and audit_log.actor_id —
// both FKs to the auth user table (text PK), so a stub session still needs
// a real user row behind it.
async function seedUser(actor: SessionUser) {
  await db.insert(user).values({
    id: actor.id,
    name: actor.name,
    email: actor.email,
  });
}

// Standard two-site fixture: locA1/locA2 sit on site A, locB on site B.
async function seedGlobalData() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB = randomUUID();

  await db.insert(site).values([
    { id: siteA, name: `t-mp-s-a-${siteA}` },
    { id: siteB, name: `t-mp-s-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t-mp-loc-a1-${locA1}` },
    { id: locA2, siteId: siteA, name: `t-mp-loc-a2-${locA2}` },
    { id: locB, siteId: siteB, name: `t-mp-loc-b-${locB}` },
  ]);

  return { siteA, siteB, locA1, locA2, locB };
}

async function seedWorkArea(args: {
  siteId: string;
  siteLocationId: string;
  isActive?: boolean;
}) {
  const id = randomUUID();
  await db.insert(workArea).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    name: `t-mp-wa-${id}`,
    ...(args.isActive === undefined ? {} : { isActive: args.isActive }),
  });
  return id;
}

async function seedShift(args: {
  siteId: string;
  siteLocationId: string;
  orderIndex?: number;
  isActive?: boolean;
}) {
  const id = randomUUID();
  await db.insert(shiftDefinition).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    label: `t-mp-shift-${id}`,
    orderIndex: args.orderIndex ?? 1,
    startTime: "06:00",
    endTime: "14:00",
    ...(args.isActive === undefined ? {} : { isActive: args.isActive }),
  });
  return id;
}

async function seedPosition(args: {
  siteId: string;
  isActive?: boolean;
}) {
  const id = randomUUID();
  await db.insert(position).values({
    id,
    siteId: args.siteId,
    name: `t-mp-pos-${id}`,
    ...(args.isActive === undefined ? {} : { isActive: args.isActive }),
  });
  return id;
}

async function seedPivot(args: {
  workAreaId: string;
  positionId: string;
  siteId: string;
  siteLocationId: string;
}) {
  await db.insert(workAreaPosition).values(args);
}

async function seedRequest(args: {
  siteId: string;
  siteLocationId: string;
  createdBy: string;
  type: "weekly" | "daily";
  weekStart?: string;
  requestDate?: string;
  status?: "open" | "approved" | "fulfilled" | "rejected" | "withdrawn";
}) {
  const id = randomUUID();
  await db.insert(mpRequest).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    type: args.type,
    weekStart: args.weekStart,
    requestDate: args.requestDate,
    status: args.status,
    createdBy: args.createdBy,
  });
  return id;
}

async function seedLine(args: {
  requestId: string;
  siteId: string;
  siteLocationId: string;
  workAreaId: string;
  shiftDefinitionId: string;
  positionId: string;
  date: string;
  headcount: number;
}) {
  await db.insert(mpRequestLine).values(args);
}

// FK-safe teardown: audit rows pin the user, and the request children must
// go before the work areas / shifts they weld to. Lines and requests are
// deleted by fixture location (not by tracked id — actions create rows the
// tests never hold ids for), which keeps every t-mp- row out of the way.
async function dropAll(fx: {
  userIds: string[];
  workAreaIds?: string[];
  shiftIds?: string[];
  positionIds?: string[];
  locA1: string;
  locA2: string;
  locB: string;
  siteA: string;
  siteB: string;
}) {
  const locIds = [fx.locA1, fx.locA2, fx.locB];
  for (const userId of fx.userIds) {
    await db.delete(auditLog).where(eq(auditLog.actorId, userId));
  }
  await db.delete(mpRequestLine).where(inArray(mpRequestLine.siteLocationId, locIds));
  await db.delete(mpRequest).where(inArray(mpRequest.siteLocationId, locIds));
  // The pivot welds RESTRICT on both sides: it must go before the work
  // areas AND the positions it pairs.
  if ((fx.workAreaIds ?? []).length > 0) {
    await db
      .delete(workAreaPosition)
      .where(inArray(workAreaPosition.workAreaId, fx.workAreaIds!));
  }
  for (const workAreaId of fx.workAreaIds ?? []) {
    await db.delete(workArea).where(eq(workArea.id, workAreaId));
  }
  for (const shiftId of fx.shiftIds ?? []) {
    await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
  }
  for (const positionId of fx.positionIds ?? []) {
    await db.delete(position).where(eq(position.id, positionId));
  }
  for (const userId of fx.userIds) {
    await db.delete(user).where(eq(user.id, userId));
  }
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
  await db.delete(site).where(eq(site.id, fx.siteA));
  await db.delete(site).where(eq(site.id, fx.siteB));
}

function weeklyInput(args: {
  siteLocationId?: string;
  lines: MpRequestLineInput[];
}): MpRequestCreateInput {
  return {
    ...(args.siteLocationId ? { siteLocationId: args.siteLocationId } : {}),
    type: "weekly",
    weekStart: MONDAY,
    lines: args.lines,
  };
}

describe("request actions: createRequest", () => {
  test("admin create is pinned to their location: rows and audit land", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({
        // A foreign pick is ignored — the admin binding pins the location.
        siteLocationId: fx.locB,
        lines: [
          {
            workAreaId: waA1,
            shiftDefinitionId: shiftA1,
            positionId: posA1,
            date: MONDAY,
            headcount: 2,
          },
          {
            workAreaId: waA1,
            shiftDefinitionId: shiftA1,
            positionId: posA1,
            date: "2026-03-04",
            headcount: 3,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(row).toBeDefined();
    expect(row.siteId).toBe(fx.siteA);
    expect(row.type).toBe("weekly");
    expect(row.weekStart).toBe(MONDAY);
    expect(row.requestDate).toBeNull();
    expect(row.status).toBe("open");
    expect(row.createdBy).toBe(actor.id);

    const lines = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, row.id));
    expect(lines.length).toBe(2);
    expect(lines.every((line) => line.siteId === fx.siteA)).toBe(true);
    // Each line carries its demanded position (#135).
    expect(lines.every((line) => line.positionId === posA1)).toBe(true);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.create"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe(actor.id);
    expect(audit.siteId).toBe(fx.siteA);
    expect(audit.siteLocationId).toBe(fx.locA1);
    expect(audit.details).toEqual({
      requestId: row.id,
      type: "weekly",
      lineCount: 2,
    });
  });

  test("ho create is refused: only admins enter requests", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("ho", fx.siteA, null);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({ siteLocationId: fx.locA1, lines: [] }),
    );

    expect(result).toEqual({ ok: false, message: "Only admins enter requests" });

    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(0);
  });

  test("duplicate open request for the same week: friendly message", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const input = weeklyInput({
      lines: [
        {
          workAreaId: waA1,
          shiftDefinitionId: shiftA1,
          positionId: posA1,
          date: MONDAY,
          headcount: 1,
        },
      ],
    });
    expect((await createRequest(input)).ok).toBe(true);

    const second = await createRequest(input);
    expect(second.ok).toBe(false);
    expect(second.message).toBe(
      "An open request for this week/date already exists",
    );

    // The refusal wrote nothing: exactly one request for the week.
    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(1);
  });

  test("line with a foreign-location work area: FK message, nothing written", async () => {
    const fx = await seedGlobalData();
    const waB = await seedWorkArea({ siteId: fx.siteB, siteLocationId: fx.locB });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posB = await seedPosition({ siteId: fx.siteB });
    await seedPivot({
      workAreaId: waB,
      positionId: posB,
      siteId: fx.siteB,
      siteLocationId: fx.locB,
    });
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waB],
        shiftIds: [shiftA1],
        positionIds: [posB],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({
        siteLocationId: fx.locA1,
        lines: [
          {
            workAreaId: waB,
            shiftDefinitionId: shiftA1,
            positionId: posB,
            date: MONDAY,
            headcount: 1,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Selected work area, shift or position must belong to this request's location",
    );

    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(0);
  });
  test("line with a soft-deleted work area: refused, nothing written", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    // Soft-deleted rows still satisfy the weld FKs — liveness is the
    // pre-check's job.
    await db
      .update(workArea)
      .set({ deletedAt: new Date() })
      .where(eq(workArea.id, waA1));
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({
        siteLocationId: fx.locA1,
        lines: [
          {
            workAreaId: waA1,
            shiftDefinitionId: shiftA1,
            positionId: posA1,
            date: MONDAY,
            headcount: 1,
          },
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      message: "Selected work area, shift or position no longer exists",
    });

    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(0);
  });
});

describe("request actions: updateRequestLines", () => {
  test("updateRequestLines on an approved request is refused", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
      status: "approved",
    });
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      positionId: posA1,
      date: MONDAY,
      headcount: 1,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { updateRequestLines } = await import("./actions");
    const result = await updateRequestLines(requestId, [
      {
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date: MONDAY,
        headcount: 9,
      },
    ]);

    expect(result).toEqual({
      ok: false,
      message: "Only open requests can be edited",
    });

    // The refusal wrote nothing: headcount untouched.
    const [line] = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(line.headcount).toBe(1);
  });

  test("inactive-preserve: keeping the line passes, re-adding the inactive shift fails", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });
    const keptLine: MpRequestLineInput = {
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      positionId: posA1,
      date: MONDAY,
      headcount: 2,
    };
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      ...keptLine,
    });

    // The shift dies after the request was entered.
    await db
      .update(shiftDefinition)
      .set({ isActive: false })
      .where(eq(shiftDefinition.id, shiftA1));

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { updateRequestLines } = await import("./actions");

    // Keeping the line unchanged survives the deactivation.
    const keep = await updateRequestLines(requestId, [keptLine]);
    expect(keep.ok).toBe(true);

    const linesAfterKeep = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(linesAfterKeep.length).toBe(1);
    expect(linesAfterKeep[0].headcount).toBe(2);

    const [updateAudit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.update"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(updateAudit).toBeDefined();
    expect(updateAudit.actorId).toBe(actor.id);
    expect(updateAudit.details).toEqual({
      requestId,
      oldLineCount: 1,
      newLineCount: 1,
    });

    // Re-adding the inactive shift on a NEW line is refused.
    const reAdd = await updateRequestLines(requestId, [
      keptLine,
      {
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date: "2026-03-04",
        headcount: 3,
      },
    ]);
    expect(reAdd.ok).toBe(false);
    expect(reAdd.fieldErrors?.lines).toBeDefined();

    const linesAfterReAdd = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(linesAfterReAdd.length).toBe(1);
  });

  test("a same-site position outside the area's required set: refused, nothing written", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    // posA1 lives on site A but is NOT pivoted onto waA1 — not a required
    // position of the area, so the line is refused before any write.
    const posA1 = await seedPosition({ siteId: fx.siteA });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({
        lines: [
          {
            workAreaId: waA1,
            shiftDefinitionId: shiftA1,
            positionId: posA1,
            date: MONDAY,
            headcount: 2,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.lines).toBe(
      "Position must be a required position of the work area",
    );

    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(0);
  });

  test("a cross-site position: FK message, nothing written", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    // A site-B position cannot be pivoted onto waA1 (the weld forbids it),
    // so the line can only forge the reference — refused on site mismatch.
    const posB = await seedPosition({ siteId: fx.siteB });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1, posB],
        ...fx,
      });
    });
    const { createRequest } = await import("./actions");
    const result = await createRequest(
      weeklyInput({
        lines: [
          {
            workAreaId: waA1,
            shiftDefinitionId: shiftA1,
            positionId: posB,
            date: MONDAY,
            headcount: 1,
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Selected work area, shift or position must belong to this request's location",
    );

    const rows = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.length).toBe(0);
  });

  test("duplicate wa|shift|position|date in one submit: LINE_DUPLICATE, stored lines intact", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      positionId: posA1,
      date: MONDAY,
      headcount: 1,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { updateRequestLines } = await import("./actions");
    const duplicate = await updateRequestLines(requestId, [
      {
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date: MONDAY,
        headcount: 2,
      },
      {
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date: MONDAY,
        headcount: 5,
      },
    ]);

    expect(duplicate.ok).toBe(false);
    expect(duplicate.fieldErrors?.lines).toBe(
      "Duplicate work area, shift, position and date combination",
    );

    // The refusal rolled back: the stored line survives untouched.
    const lines = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(lines.length).toBe(1);
    expect(lines[0].headcount).toBe(1);
  });

  test("inactive-preserve for positions: keeping the line passes, re-adding the inactive position fails", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });
    const keptLine: MpRequestLineInput = {
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      positionId: posA1,
      date: MONDAY,
      headcount: 4,
    };
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      ...keptLine,
    });

    // The position dies after the request was entered (pivot intact — the
    // weld does not follow deactivation).
    await db.update(position).set({ isActive: false }).where(eq(position.id, posA1));

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { updateRequestLines } = await import("./actions");

    // Keeping the stored line byte-identical survives the deactivation.
    const keep = await updateRequestLines(requestId, [keptLine]);
    expect(keep.ok).toBe(true);
    const linesAfterKeep = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(linesAfterKeep.length).toBe(1);
    expect(linesAfterKeep[0].headcount).toBe(4);

    // Re-adding the inactive position on a NEW date is refused.
    const reAdd = await updateRequestLines(requestId, [
      keptLine,
      {
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date: "2026-03-05",
        headcount: 2,
      },
    ]);
    expect(reAdd.ok).toBe(false);
    expect(reAdd.fieldErrors?.lines).toBe(
      "Inactive positions can only be kept unchanged, not re-added",
    );

    const linesAfterReAdd = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(linesAfterReAdd.length).toBe(1);
  });
});

describe("request actions: advanceStatus", () => {
  async function statusOf(requestId: string) {
    const [row] = await db
      .select()
      .from(mpRequest)
      .where(eq(mpRequest.id, requestId));
    return row.status;
  }

  test("ho approves an open weekly request: status approved + one audit row old→new", async () => {
    const fx = await seedGlobalData();
    const creator = makeActor("admin", null, fx.locA1);
    await seedUser(creator);
    actor = makeActor("ho", fx.siteA, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: creator.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id, creator.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(requestId, "approved");
    expect(result.ok).toBe(true);
    expect(await statusOf(requestId)).toBe("approved");

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.status_change"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toEqual({
      requestId,
      type: "weekly",
      oldValue: "open",
      newValue: "approved",
    });
  });

  test("superadmin rejects an open weekly request", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(requestId, "rejected");
    expect(result.ok).toBe(true);
    expect(await statusOf(requestId)).toBe("rejected");

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.status_change"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(audit.details).toEqual({
      requestId,
      type: "weekly",
      oldValue: "open",
      newValue: "rejected",
    });
  });

  test("admin of the same location is refused with the approver-only message and the row stays open", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(requestId, "approved");
    expect(result).toEqual({
      ok: false,
      message: "Only HO can approve or reject requests.",
    });
    expect(await statusOf(requestId)).toBe("open");

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, actor.id));
    expect(audits).toHaveLength(0);
  });

  test("approved → rejected is refused as an illegal transition", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
      status: "approved",
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(requestId, "rejected");
    expect(result).toEqual({
      ok: false,
      message: "That status change is not allowed",
    });
    expect(await statusOf(requestId)).toBe("approved");
  });

  test("approving a daily request is refused with the weekly-only message", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "daily",
      requestDate: "2026-03-04",
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(requestId, "approved");
    expect(result).toEqual({
      ok: false,
      message: "Only weekly requests need approval.",
    });
    expect(await statusOf(requestId)).toBe("open");
  });

  test("fulfilled is not a target status: refused at the runtime boundary", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
      status: "approved",
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const result = await advanceStatus(
      requestId,
      "fulfilled" as Parameters<typeof advanceStatus>[1],
    );
    expect(result.ok).toBe(false);
    expect(await statusOf(requestId)).toBe("approved");
  });

  test("two concurrent approvals: exactly one ok, the other gets the race message", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { advanceStatus } = await import("./actions");
    const results = await Promise.all([
      advanceStatus(requestId, "approved"),
      advanceStatus(requestId, "approved"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The loser blocks on the row lock, re-reads "approved" and is refused
    // as an illegal edge; a loser that read before the winner committed
    // trips the guarded write instead.
    const loser = results.find((r) => !r.ok);
    expect(loser?.message).toBeOneOf([
      "Request state changed, reload",
      "That status change is not allowed",
    ]);
    expect(await statusOf(requestId)).toBe("approved");
  });
});

describe("request actions: withdrawRequest", () => {
  async function statusOf(requestId: string) {
    const [row] = await db
      .select()
      .from(mpRequest)
      .where(eq(mpRequest.id, requestId));
    return row.status;
  }

  async function auditsOf(actorId: string) {
    return db.select().from(auditLog).where(eq(auditLog.actorId, actorId));
  }

  test("admin withdraws an open weekly request at their location: status withdrawn + one audit row old→new", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    const result = await withdrawRequest(requestId);
    expect(result.ok).toBe(true);
    expect(await statusOf(requestId)).toBe("withdrawn");

    const audits = await auditsOf(actor.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("mp_request.status_change");
    expect(audits[0].siteId).toBe(fx.siteA);
    expect(audits[0].siteLocationId).toBe(fx.locA1);
    expect(audits[0].details).toEqual({
      requestId,
      type: "weekly",
      oldValue: "open",
      newValue: "withdrawn",
    });
  });

  test("admin withdraws an open daily request", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "daily",
      requestDate: "2026-03-04",
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    expect((await withdrawRequest(requestId)).ok).toBe(true);
    expect(await statusOf(requestId)).toBe("withdrawn");

    const audits = await auditsOf(actor.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toEqual({
      requestId,
      type: "daily",
      oldValue: "open",
      newValue: "withdrawn",
    });
  });

  test("superadmin withdraws any open request", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteB,
      siteLocationId: fx.locB,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    expect((await withdrawRequest(requestId)).ok).toBe(true);
    expect(await statusOf(requestId)).toBe("withdrawn");
    expect(await auditsOf(actor.id)).toHaveLength(1);
  });

  test("HO is refused with the HO message and the row stays open (no audit row)", async () => {
    const fx = await seedGlobalData();
    const creator = makeActor("admin", null, fx.locA1);
    await seedUser(creator);
    actor = makeActor("ho", fx.siteA, null);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: creator.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id, creator.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    const result = await withdrawRequest(requestId);
    expect(result).toEqual({
      ok: false,
      message: "HO rejects requests instead of withdrawing them.",
    });
    expect(await statusOf(requestId)).toBe("open");
    expect(await auditsOf(actor.id)).toHaveLength(0);
  });

  test("an admin cannot withdraw another location's request (not found, row unchanged)", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA2,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    const result = await withdrawRequest(requestId);
    expect(result).toEqual({ ok: false, message: "Request not found." });
    expect(await statusOf(requestId)).toBe("open");
    expect(await auditsOf(actor.id)).toHaveLength(0);
  });

  test("a malformed id is refused with field errors", async () => {
    actor = makeActor("superadmin", null, null);
    const { withdrawRequest } = await import("./actions");
    const result = await withdrawRequest("not-a-uuid");
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toBeDefined();
  });

  test("approved, fulfilled, rejected and withdrawn requests are refused with the not-withdrawable message", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("superadmin", null, null);
    await seedUser(actor);
    const statuses = ["approved", "fulfilled", "rejected", "withdrawn"] as const;
    const ids: Record<string, string> = {};
    for (const [index, status] of statuses.entries()) {
      ids[status] = await seedRequest({
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        createdBy: actor.id,
        type: "weekly",
        // Distinct anchors keep the one-open-per-week index out of the way.
        weekStart: `2026-03-${String(9 + index * 7).padStart(2, "0")}`,
        status,
      });
    }

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [actor.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    for (const status of statuses) {
      const result = await withdrawRequest(ids[status]);
      expect(result).toEqual({
        ok: false,
        message: "Only open requests can be withdrawn.",
      });
      expect(await statusOf(ids[status])).toBe(status);
    }
    expect(await auditsOf(actor.id)).toHaveLength(0);
  });

  test("after a withdraw a new weekly request for the same location and week can be created", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { createRequest, withdrawRequest } = await import("./actions");
    const input = weeklyInput({
      lines: [
        {
          workAreaId: waA1,
          shiftDefinitionId: shiftA1,
          positionId: posA1,
          date: MONDAY,
          headcount: 2,
        },
      ],
    });
    // The open request holds the week's slot until it is withdrawn.
    expect((await createRequest(input)).ok).toBe(false);

    expect((await withdrawRequest(requestId)).ok).toBe(true);
    expect((await createRequest(input)).ok).toBe(true);

    const rows = await db
      .select({ id: mpRequest.id, status: mpRequest.status })
      .from(mpRequest)
      .where(eq(mpRequest.siteLocationId, fx.locA1));
    expect(rows.map((r) => r.status).sort()).toEqual(["open", "withdrawn"]);
  });

  test("a withdrawn request is absent from loadRequirementsForWeek and loadDailyRequirements", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const dailyDate = "2026-03-05";
    // Week A's request is withdrawn through the action; week B's approved
    // request is the live control proving the weekly loader returns demand.
    const weekB = "2026-03-09";
    const weeklyId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: MONDAY,
    });
    const controlId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "weekly",
      weekStart: weekB,
      status: "approved",
    });
    const dailyId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "daily",
      requestDate: dailyDate,
    });
    for (const [requestId, date] of [
      [weeklyId, MONDAY],
      [controlId, weekB],
      [dailyId, dailyDate],
    ] as const) {
      await seedLine({
        requestId,
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        workAreaId: waA1,
        shiftDefinitionId: shiftA1,
        positionId: posA1,
        date,
        headcount: 2,
      });
    }

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { loadDailyRequirements, loadRequirementsForWeek } = await import(
      "@/lib/roster-data"
    );
    const { withdrawRequest } = await import("./actions");
    // The daily request is live demand until withdrawn.
    expect(
      await loadDailyRequirements(fx.locA1, dailyDate, dailyDate),
    ).toHaveLength(1);

    expect((await withdrawRequest(weeklyId)).ok).toBe(true);
    expect((await withdrawRequest(dailyId)).ok).toBe(true);

    const weekALines = [
      {
        workAreaId: waA1,
        shiftDefId: shiftA1,
        positionId: posA1,
        date: MONDAY,
        headcount: 2,
      },
    ];
    expect(await loadRequirementsForWeek(fx.locA1, weekB)).toEqual([
      { ...weekALines[0], date: weekB },
    ]);
    expect(await loadRequirementsForWeek(fx.locA1, MONDAY)).toEqual([]);
    // The same request counted as demand under a live status, so the empty
    // result above comes from "withdrawn" and nothing else.
    await db
      .update(mpRequest)
      .set({ status: "approved" })
      .where(eq(mpRequest.id, weeklyId));
    expect(await loadRequirementsForWeek(fx.locA1, MONDAY)).toEqual(weekALines);
    await db
      .update(mpRequest)
      .set({ status: "withdrawn" })
      .where(eq(mpRequest.id, weeklyId));
    expect(await loadRequirementsForWeek(fx.locA1, MONDAY)).toEqual([]);
    expect(await loadDailyRequirements(fx.locA1, dailyDate, dailyDate)).toEqual([]);
  });

  test("concurrent approve and withdraw of one open request: exactly one succeeds and the final status matches the winner", async () => {
    const fx = await seedGlobalData();
    const admin = makeActor("admin", null, fx.locA1);
    const ho = makeActor("ho", fx.siteA, null);
    await seedUser(admin);
    await seedUser(ho);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: admin.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [admin.id, ho.id], ...fx });
    });
    const { advanceStatus, withdrawRequest } = await import("./actions");
    // Each action resolves its actor synchronously on entry, so swapping
    // the stub between the two calls hands each its own role.
    actor = ho;
    const approving = advanceStatus(requestId, "approved");
    actor = admin;
    const withdrawing = withdrawRequest(requestId);
    const [approveResult, withdrawResult] = await Promise.all([
      approving,
      withdrawing,
    ]);

    expect([approveResult.ok, withdrawResult.ok].filter(Boolean)).toHaveLength(1);
    if (approveResult.ok) {
      expect(await statusOf(requestId)).toBe("approved");
      expect(withdrawResult.message).toBeOneOf([
        "Request state changed, reload",
        "Only open requests can be withdrawn.",
      ]);
    } else {
      expect(await statusOf(requestId)).toBe("withdrawn");
      expect(approveResult.message).toBeOneOf([
        "Request state changed, reload",
        "That status change is not allowed",
      ]);
    }
  });

  test("two concurrent withdraws of one open request: exactly one ok, one refusal, one audit row", async () => {
    const fx = await seedGlobalData();
    const admin = makeActor("admin", null, fx.locA1);
    await seedUser(admin);
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: admin.id,
      type: "weekly",
      weekStart: MONDAY,
    });

    fixtureCleanup.defer(async () => {
      await dropAll({ userIds: [admin.id], ...fx });
    });
    const { withdrawRequest } = await import("./actions");
    // A double-click on the confirm button: both calls start before either
    // resolves, and both share the actor.
    actor = admin;
    const first = withdrawRequest(requestId);
    const second = withdrawRequest(requestId);
    const results = await Promise.all([first, second]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused?.message).toBeOneOf([
      "Request state changed, reload",
      "Only open requests can be withdrawn.",
    ]);
    expect(await statusOf(requestId)).toBe("withdrawn");

    const audits = (await auditsOf(admin.id)).filter(
      (row) =>
        row.action === "mp_request.status_change" &&
        (row.details as { requestId?: string } | null)?.requestId ===
          requestId,
    );
    expect(audits).toHaveLength(1);
  });

  test("a daily request withdrawn after a partial fill leaves the daily plan's assignments untouched", async () => {
    const fx = await seedGlobalData();
    const waA1 = await seedWorkArea({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const shiftA1 = await seedShift({ siteId: fx.siteA, siteLocationId: fx.locA1 });
    const posA1 = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId: waA1,
      positionId: posA1,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
    });
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const date = "2026-03-04";
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      createdBy: actor.id,
      type: "daily",
      requestDate: date,
    });
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      positionId: posA1,
      date,
      headcount: 2,
    });
    // The state a first fill leaves behind: the daily plan sourced from the
    // request, holding one of the two demanded heads.
    const workerId = randomUUID();
    await db.insert(worker).values({
      id: workerId,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      employeeId: `t-mp-emp-${workerId}`,
      name: `t-mp-worker-${workerId}`,
    });
    const [plan] = await db
      .insert(rosterPlan)
      .values({
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        kind: "daily",
        requestDate: date,
        sourceRequestId: requestId,
        rulesSnapshot: { shifts: [], areas: {} },
      })
      .returning({ id: rosterPlan.id });
    await db.insert(rosterAssignment).values({
      planId: plan.id,
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      workerId,
      workAreaId: waA1,
      shiftDefinitionId: shiftA1,
      date,
    });

    fixtureCleanup.defer(async () => {
      await db.delete(rosterAssignment).where(eq(rosterAssignment.planId, plan.id));
      await db.delete(rosterPlan).where(eq(rosterPlan.id, plan.id));
      await db.delete(worker).where(eq(worker.id, workerId));
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    });
    const { withdrawRequest } = await import("./actions");
    expect((await withdrawRequest(requestId)).ok).toBe(true);
    expect(await statusOf(requestId)).toBe("withdrawn");

    const assignments = await db
      .select()
      .from(rosterAssignment)
      .where(eq(rosterAssignment.planId, plan.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].workerId).toBe(workerId);
    const plans = await db
      .select({ id: rosterPlan.id, status: rosterPlan.status })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locA1));
    expect(plans).toEqual([{ id: plan.id, status: "draft" }]);
  });
});

describe("request actions: loadCopySource", () => {
  const WEEK_1 = "2026-02-02";
  const WEEK_2 = "2026-02-09";
  const WEEK_3 = "2026-02-16";

  async function seedMasters(
    fx: Awaited<ReturnType<typeof seedGlobalData>>,
    siteLocationId: string = fx.locA1,
  ) {
    const workAreaId = await seedWorkArea({ siteId: fx.siteA, siteLocationId });
    const shiftId = await seedShift({ siteId: fx.siteA, siteLocationId });
    const positionId = await seedPosition({ siteId: fx.siteA });
    await seedPivot({
      workAreaId,
      positionId,
      siteId: fx.siteA,
      siteLocationId,
    });
    return { workAreaId, shiftId, positionId };
  }

  async function seedWeek(
    fx: Awaited<ReturnType<typeof seedGlobalData>>,
    masters: Awaited<ReturnType<typeof seedMasters>>,
    args: {
      createdBy: string;
      weekStart: string;
      headcount: number;
      status?: "open" | "approved" | "fulfilled" | "rejected" | "withdrawn";
      siteLocationId?: string;
    },
  ) {
    const requestId = await seedRequest({
      siteId: fx.siteA,
      siteLocationId: args.siteLocationId ?? fx.locA1,
      createdBy: args.createdBy,
      type: "weekly",
      weekStart: args.weekStart,
      status: args.status,
    });
    await seedLine({
      requestId,
      siteId: fx.siteA,
      siteLocationId: args.siteLocationId ?? fx.locA1,
      workAreaId: masters.workAreaId,
      shiftDefinitionId: masters.shiftId,
      positionId: masters.positionId,
      date: args.weekStart,
      headcount: args.headcount,
    });
    return requestId;
  }

  test("returns the latest earlier week with an open, approved or fulfilled request, skips weeks holding only rejected ones, returns null when none, and never returns another location's request for an admin", async () => {
    const fx = await seedGlobalData();
    const masters = await seedMasters(fx);
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const otherAdmin = makeActor("admin", null, fx.locA2);
    await seedUser(otherAdmin);
    // Filled in mid-test; the teardown below reads it when it runs.
    const other: { masters?: Awaited<ReturnType<typeof seedMasters>> } = {};

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id, otherAdmin.id],
        workAreaIds: [masters.workAreaId, ...(other.masters ? [other.masters.workAreaId] : [])],
        shiftIds: [masters.shiftId, ...(other.masters ? [other.masters.shiftId] : [])],
        positionIds: [masters.positionId, ...(other.masters ? [other.masters.positionId] : [])],
        ...fx,
      });
    });
    const { loadCopySource } = await import("./actions");

    // Nothing yet.
    expect(await loadCopySource(fx.locA1, WEEK_3)).toBeNull();

    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 2,
      status: "approved",
    });
    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_2,
      headcount: 7,
      status: "rejected",
    });

    // The newer rejected week is skipped for the older approved one.
    const skipped = await loadCopySource(fx.locA1, WEEK_3);
    expect(skipped?.weekStart).toBe(WEEK_1);
    expect(skipped?.lines).toHaveLength(1);
    expect(skipped?.lines[0]).toMatchObject({
      workAreaId: masters.workAreaId,
      workAreaName: `t-mp-wa-${masters.workAreaId}`,
      shiftDefinitionId: masters.shiftId,
      shiftLabel: `t-mp-shift-${masters.shiftId}`,
      positionId: masters.positionId,
      positionName: `t-mp-pos-${masters.positionId}`,
      date: WEEK_1,
      headcount: 2,
    });

    // An open later week wins; only weeks strictly before the anchor count.
    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_3,
      headcount: 9,
      status: "open",
    });
    const latest = await loadCopySource(fx.locA1, "2026-02-23");
    expect(latest?.weekStart).toBe(WEEK_3);
    expect(latest?.lines[0].headcount).toBe(9);
    expect((await loadCopySource(fx.locA1, WEEK_3))?.weekStart).toBe(WEEK_1);
    expect(await loadCopySource(fx.locA1, WEEK_1)).toBeNull();

    // Another location's request never leaks to an admin.
    const mastersA2 = await seedMasters(fx, fx.locA2);
    other.masters = mastersA2;
    await seedWeek(fx, mastersA2, {
      createdBy: otherAdmin.id,
      weekStart: WEEK_2,
      headcount: 4,
      status: "approved",
      siteLocationId: fx.locA2,
    });
    expect(await loadCopySource(fx.locA2, "2026-03-02")).toBeNull();
    expect((await loadCopySource(fx.locA1, "2026-03-02"))?.weekStart).toBe(WEEK_3);

    // Malformed input fails closed.
    expect(await loadCopySource("not-a-uuid", WEEK_3)).toBeNull();
    expect(await loadCopySource(fx.locA1, "soon")).toBeNull();
  });

  test("withdrawn requests are left out of the copy source: a withdrawn-only week is skipped for the next earlier week, and a week mixing fulfilled and withdrawn copies only the fulfilled lines", async () => {
    const fx = await seedGlobalData();
    const masters = await seedMasters(fx);
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [masters.workAreaId],
        shiftIds: [masters.shiftId],
        positionIds: [masters.positionId],
        ...fx,
      });
    });
    const { loadCopySource } = await import("./actions");

    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 2,
      status: "fulfilled",
    });
    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 6,
      status: "withdrawn",
    });
    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_2,
      headcount: 9,
      status: "withdrawn",
    });

    const source = await loadCopySource(fx.locA1, WEEK_3);
    expect(source?.weekStart).toBe(WEEK_1);
    expect(source?.lines).toHaveLength(1);
    expect(source?.lines[0]).toMatchObject({ date: WEEK_1, headcount: 2 });

    // Only the week-1 requests precede week 2, and week 1 holds no
    // withdrawn lines in its source; nothing precedes week 1.
    expect((await loadCopySource(fx.locA1, WEEK_2))?.lines).toHaveLength(1);
    expect(await loadCopySource(fx.locA1, WEEK_1)).toBeNull();
  });

  test("merges every open, approved or fulfilled request of the latest week: a fulfilled request plus a late approved delta are summed, rejected ones are excluded", async () => {
    const fx = await seedGlobalData();
    const masters = await seedMasters(fx);
    actor = makeActor("admin", null, fx.locA1);
    await seedUser(actor);
    const TUESDAY = "2026-02-03";

    fixtureCleanup.defer(async () => {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [masters.workAreaId],
        shiftIds: [masters.shiftId],
        positionIds: [masters.positionId],
        ...fx,
      });
    });
    const { loadCopySource } = await import("./actions");
    const line = (requestId: string, date: string, headcount: number) =>
      seedLine({
        requestId,
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        workAreaId: masters.workAreaId,
        shiftDefinitionId: masters.shiftId,
        positionId: masters.positionId,
        date,
        headcount,
      });

    // Seeded late-first so insertion order cannot decide the answer.
    const late = await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 1,
      status: "approved",
    });
    await line(late, TUESDAY, 3);
    const rejected = await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 5,
      status: "rejected",
    });
    await line(rejected, TUESDAY, 5);
    await seedWeek(fx, masters, {
      createdBy: actor.id,
      weekStart: WEEK_1,
      headcount: 2,
      status: "fulfilled",
    });

    const source = await loadCopySource(fx.locA1, WEEK_2);
    const shared = {
      workAreaId: masters.workAreaId,
      workAreaName: `t-mp-wa-${masters.workAreaId}`,
      shiftDefinitionId: masters.shiftId,
      shiftLabel: `t-mp-shift-${masters.shiftId}`,
      positionId: masters.positionId,
      positionName: `t-mp-pos-${masters.positionId}`,
    };
    expect(source).toEqual({
      weekStart: WEEK_1,
      lines: [
        { ...shared, date: WEEK_1, headcount: 3 },
        { ...shared, date: TUESDAY, headcount: 3 },
      ],
    });
  });
});
