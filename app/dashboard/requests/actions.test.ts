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
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import type {
  MpRequestCreateInput,
  MpRequestLineInput,
} from "@/validation/request-line";

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
mock.module("next/cache", () => ({
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
  status?: "open" | "approved" | "fulfilled" | "rejected";
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
  });

  test("ho create is refused: only admins enter requests", async () => {
    const fx = await seedGlobalData();
    actor = makeActor("ho", fx.siteA, null);
    await seedUser(actor);

    try {
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
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waB],
        shiftIds: [shiftA1],
        positionIds: [posB],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1, posB],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({
        userIds: [actor.id],
        workAreaIds: [waA1],
        shiftIds: [shiftA1],
        positionIds: [posA1],
        ...fx,
      });
    }
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

    try {
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
    } finally {
      await dropAll({ userIds: [actor.id, creator.id], ...fx });
    }
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

    try {
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
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
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
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
      const { advanceStatus } = await import("./actions");
      const result = await advanceStatus(requestId, "rejected");
      expect(result).toEqual({
        ok: false,
        message: "That status change is not allowed",
      });
      expect(await statusOf(requestId)).toBe("approved");
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
      const { advanceStatus } = await import("./actions");
      const result = await advanceStatus(requestId, "approved");
      expect(result).toEqual({
        ok: false,
        message: "Only weekly requests need approval.",
      });
      expect(await statusOf(requestId)).toBe("open");
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
      const { advanceStatus } = await import("./actions");
      const result = await advanceStatus(
        requestId,
        "fulfilled" as Parameters<typeof advanceStatus>[1],
      );
      expect(result.ok).toBe(false);
      expect(await statusOf(requestId)).toBe("approved");
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
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

    try {
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
    } finally {
      await dropAll({ userIds: [actor.id], ...fx });
    }
  });
});
