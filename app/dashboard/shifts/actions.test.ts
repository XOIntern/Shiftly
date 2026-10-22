import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, shiftDefinition } from "@/drizzle/schema";
import {
  mpRequest,
  mpRequestLine,
  user,
  workArea,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import type {
  ShiftCreateInput,
  ShiftUpdateInput,
} from "@/validation/validators";

// The shift actions resolve their actor through requireUser — swapped
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

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T-Shift Actor",
    email: `t-shift-act-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// Standard two-site fixture: locA1/locA2 sit on site A, locB on site B.
async function seedGlobalData() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB = randomUUID();

  await db.insert(site).values([
    { id: siteA, name: `t-shift-s-a-${siteA}` },
    { id: siteB, name: `t-shift-s-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t-shift-loc-a1-${locA1}` },
    { id: locA2, siteId: siteA, name: `t-shift-loc-a2-${locA2}` },
    { id: locB, siteId: siteB, name: `t-shift-loc-b-${locB}` },
  ]);

  return { siteA, siteB, locA1, locA2, locB };
}

async function seedShift(args: {
  siteId: string;
  siteLocationId: string;
  label?: string;
  orderIndex?: number;
}) {
  const id = randomUUID();
  await db.insert(shiftDefinition).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    label: args.label ?? "T-Shift Seeded",
    orderIndex: args.orderIndex ?? 1,
    startTime: "06:00",
    endTime: "14:00",
  });
  return id;
}

type ShiftInputArgs = {
  siteLocationId: string;
  label?: string;
  orderIndex?: number;
  startTime?: string;
  endTime?: string;
  isActive?: boolean;
};

// Overloads: update calls (isActive present) yield ShiftUpdateInput,
// create calls (no isActive) yield ShiftCreateInput. The update overload
// lists first — TS picks the first matching overload, so the required
// isActive key must discriminate before the optional one.
function shiftInput(
  args: ShiftInputArgs & { isActive: boolean },
): ShiftUpdateInput;
function shiftInput(args: ShiftInputArgs): ShiftCreateInput;
function shiftInput(args: ShiftInputArgs) {
  return {
    siteLocationId: args.siteLocationId,
    label: args.label ?? "T-Shift Action Shift",
    orderIndex: args.orderIndex ?? 4,
    startTime: args.startTime ?? "06:00",
    endTime: args.endTime ?? "14:00",
    ...(args.isActive === undefined ? {} : { isActive: args.isActive }),
  };
}

async function dropShiftByLabel(label: string) {
  const rows = await db
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(eq(shiftDefinition.label, label));
  for (const row of rows) {
    await db.delete(shiftDefinition).where(eq(shiftDefinition.id, row.id));
  }
}

async function dropSeed(fx: {
  locA1: string;
  locA2: string;
  locB: string;
  siteA: string;
  siteB: string;
}) {
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
  await db.delete(site).where(eq(site.id, fx.siteA));
  await db.delete(site).where(eq(site.id, fx.siteB));
}

describe("shift actions: create", () => {
  test("superadmin create derives site from the location: round-trips", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createShift } = await import("./actions");
      const result = await createShift(shiftInput({ siteLocationId: fx.locA1 }));

      expect(result.ok).toBe(true);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Action Shift"));
      expect(row).toBeDefined();
      // siteId was never sent: the action derived it from the location.
      expect(row.siteId).toBe(fx.siteA);
      expect(row.siteLocationId).toBe(fx.locA1);
      expect(row.orderIndex).toBe(4);
      expect(row.startTime).toBe("06:00");
      expect(row.endTime).toBe("14:00");
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
    } finally {
      await dropShiftByLabel("T-Shift Action Shift");
      await dropSeed(fx);
    }
  });

  test("admin create is pinned to their own location, ignoring a foreign pick", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("admin", null, fx.locA1);

      const { createShift } = await import("./actions");
      const result = await createShift(
        shiftInput({ siteLocationId: fx.locB, orderIndex: 5 }),
      );

      expect(result.ok).toBe(true);
      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Action Shift"));
      expect(row.siteLocationId).toBe(fx.locA1);
      expect(row.siteId).toBe(fx.siteA);
    } finally {
      await dropShiftByLabel("T-Shift Action Shift");
      await dropSeed(fx);
    }
  });

  test("ho create with another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { createShift } = await import("./actions");
      const result = await createShift(shiftInput({ siteLocationId: fx.locB }));

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteLocationId).toBe(
        "Location must be in your site",
      );

      // The refusal writes nothing.
      const rows = await db
        .select({ id: shiftDefinition.id })
        .from(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Action Shift"));
      expect(rows.length).toBe(0);
    } finally {
      await dropSeed(fx);
    }
  });

  test("superadmin create with a nonexistent location: field error", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createShift } = await import("./actions");
      const result = await createShift(
        shiftInput({ siteLocationId: randomUUID() }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteLocationId).toBe("Location not found.");

      const rows = await db
        .select({ id: shiftDefinition.id })
        .from(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Action Shift"));
      expect(rows.length).toBe(0);
    } finally {
      await dropSeed(fx);
    }
  });

  test("create with a duplicate order_index in one location: field error on orderIndex", async () => {
    const fx = await seedGlobalData();

    try {
      await seedShift({
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        orderIndex: 4,
        label: "T-Shift Order Taker",
      });

      actor = makeActor("superadmin", null, null);

      const { createShift } = await import("./actions");
      const result = await createShift(
        shiftInput({ siteLocationId: fx.locA1, orderIndex: 4 }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.orderIndex).toBe(
        "Order is already used by another shift",
      );

      // The uniqueness is per location: another location still accepts it.
      const otherLoc = await createShift(
        shiftInput({ siteLocationId: fx.locA2, orderIndex: 4 }),
      );
      expect(otherLoc.ok).toBe(true);
    } finally {
      await db
        .delete(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Order Taker"));
      await dropShiftByLabel("T-Shift Action Shift");
      await dropSeed(fx);
    }
  });
});

describe("shift actions: update", () => {
  test("superadmin update rewrites label, order, times and isActive", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 2,
      label: "T-Shift Up Target",
    });

    try {
      actor = makeActor("superadmin", null, null);

      const { updateShift } = await import("./actions");
      const result = await updateShift(
        shiftId,
        shiftInput({
          siteLocationId: fx.locA1,
          label: "T-Shift Up Renamed",
          orderIndex: 7,
          startTime: "22:00",
          endTime: "06:00",
          isActive: false,
        }),
      );
      expect(result.ok).toBe(true);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.label).toBe("T-Shift Up Renamed");
      expect(row.orderIndex).toBe(7);
      expect(row.startTime).toBe("22:00");
      expect(row.endTime).toBe("06:00");
      expect(row.isActive).toBe(false);
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });

  test("update with a duplicate order_index: field error on orderIndex, row untouched", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 3,
      label: "T-Shift Up Dup",
    });
    await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 9,
      label: "T-Shift Up Order Taker",
    });

    try {
      actor = makeActor("superadmin", null, null);

      const { updateShift } = await import("./actions");
      const result = await updateShift(
        shiftId,
        shiftInput({
          siteLocationId: fx.locA1,
          orderIndex: 9,
          label: "T-Shift Up Dup",
          isActive: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.orderIndex).toBe(
        "Order is already used by another shift",
      );

      // The refusal writes nothing: the shift keeps its own order.
      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.orderIndex).toBe(3);
    } finally {
      await db
        .delete(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Up Dup"));
      await db
        .delete(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Up Order Taker"));
      await dropSeed(fx);
    }
  });

  test("ho update onto another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 2,
      label: "T-Shift Up Ho",
    });

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { updateShift } = await import("./actions");
      const result = await updateShift(
        shiftId,
        shiftInput({ siteLocationId: fx.locB, orderIndex: 2, isActive: true }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteLocationId).toBe(
        "Location must be in your site",
      );

      // The refusal writes nothing to the existing row.
      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.siteLocationId).toBe(fx.locA1);
      expect(row.siteId).toBe(fx.siteA);
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });

  test("update on a foreign shift: not found, row untouched", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteB,
      siteLocationId: fx.locB,
      orderIndex: 2,
      label: "T-Shift Up Foreign",
    });

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { updateShift } = await import("./actions");
      const result = await updateShift(
        shiftId,
        shiftInput({
          siteLocationId: fx.locA1,
          label: "T-Shift Up Hijack",
          orderIndex: 2,
          isActive: true,
        }),
      );
      expect(result).toEqual({ ok: false, message: "Shift not found." });

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.label).toBe("T-Shift Up Foreign");
      expect(row.siteLocationId).toBe(fx.locB);
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });

  test("update on a soft-deleted shift: not found", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 2,
      label: "T-Shift Up Gone",
    });
    await db
      .update(shiftDefinition)
      .set({ deletedAt: new Date() })
      .where(eq(shiftDefinition.id, shiftId));

    try {
      actor = makeActor("superadmin", null, null);

      const { updateShift } = await import("./actions");
      const result = await updateShift(
        shiftId,
        shiftInput({
          siteLocationId: fx.locA1,
          label: "T-Shift Up Gone Again",
          orderIndex: 2,
          isActive: true,
        }),
      );
      expect(result).toEqual({ ok: false, message: "Shift not found." });

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.label).toBe("T-Shift Up Gone");
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });
});

describe("shift actions: delete", () => {
  test("delete soft-deletes an in-scope shift", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 6,
      label: "T-Shift Del Target",
    });

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { deleteShift } = await import("./actions");
      const result = await deleteShift(shiftId);
      expect(result.ok).toBe(true);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.deletedAt).not.toBeNull();
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });

  test("delete preserves the location's order index slot for reuse", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createShift, deleteShift } = await import("./actions");
      const created = await createShift(
        shiftInput({ siteLocationId: fx.locA1, orderIndex: 6 }),
      );
      expect(created.ok).toBe(true);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.label, "T-Shift Action Shift"));
      expect(row).toBeDefined();

      const deleted = await deleteShift(row.id);
      expect(deleted.ok).toBe(true);

      // The freed partial-unique slot accepts the same order again.
      const reCreated = await createShift(
        shiftInput({ siteLocationId: fx.locA1, orderIndex: 6 }),
      );
      expect(reCreated.ok).toBe(true);
    } finally {
      await dropShiftByLabel("T-Shift Action Shift");
      await dropSeed(fx);
    }
  });


  test("delete on a foreign shift and on a missing shift: not found", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteB,
      siteLocationId: fx.locB,
      orderIndex: 1,
      label: "T-Shift Del Foreign",
    });

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { deleteShift } = await import("./actions");
      expect(await deleteShift(shiftId)).toEqual({
        ok: false,
        message: "Shift not found.",
      });
      expect(await deleteShift(randomUUID())).toEqual({
        ok: false,
        message: "Shift not found.",
      });

      // The refusals write nothing.
      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });

  test("delete refuses while a request line references the shift", async () => {
    const fx = await seedGlobalData();
    const shiftId = await seedShift({
      siteId: fx.siteA,
      siteLocationId: fx.locA1,
      orderIndex: 7,
      label: "T-Shift Guard Target",
    });

    // mp_request_line has no deleted_at: "live" is its mere existence, and
    // its request chain needs an admin user row (text PK per auth.js).
    const userId = randomUUID();
    const requestId = randomUUID();
    const lineId = randomUUID();
    const waId = randomUUID();

    try {
      await db.insert(user).values({
        id: userId,
        name: "t-shift-guard-admin",
        email: `t-shift-guard-${userId}@shiftly.test`,
      });
      await db.insert(workArea).values({
        id: waId,
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        name: `t-shift-guard-wa-${waId}`,
      });
      await db.insert(mpRequest).values({
        id: requestId,
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        type: "daily",
        requestDate: "2026-01-06",
        createdBy: userId,
      });
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: fx.siteA,
        siteLocationId: fx.locA1,
        workAreaId: waId,
        shiftDefinitionId: shiftId,
        date: "2026-01-06",
        headcount: 2,
      });

      actor = makeActor("superadmin", null, null);
      const { deleteShift } = await import("./actions");
      expect(await deleteShift(shiftId)).toEqual({
        ok: false,
        message: "Shift is still referenced by a request",
      });

      // The refusal leaves the shift live.
      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(mpRequestLine).where(eq(mpRequestLine.id, lineId));
      await db.delete(mpRequest).where(eq(mpRequest.id, requestId));
      await db.delete(workArea).where(eq(workArea.id, waId));
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await dropSeed(fx);
    }
  });
});
