import { describe, expect, test } from "bun:test";
import { rosterGate } from "./roster-gate";

const base = {
  canWrite: true,
  planStatus: null,
  approvedRequestCount: 2,
  approvedSlotCount: 7,
  blockingViolationCount: 0,
} as const;

describe("rosterGate", () => {
  test("no approved request disables generate with the HO reason", () => {
    expect(
      rosterGate({ ...base, approvedRequestCount: 0, approvedSlotCount: 0 }),
    ).toEqual({
      action: "generate",
      enabled: false,
      reason: "No weekly request for this week",
    });
  });

  test("approved requests and no plan enable generate with the slot summary", () => {
    expect(rosterGate(base)).toEqual({
      action: "generate",
      enabled: true,
      reason: "7 slots from 2 requests",
    });
  });

  test("draft with blocking violations disables publish with the warning count", () => {
    expect(
      rosterGate({ ...base, planStatus: "draft", blockingViolationCount: 3 }),
    ).toEqual({
      action: "publish",
      enabled: false,
      reason: "3 rule warnings must be resolved before publishing",
    });
  });

  test("clean draft enables publish without a reason", () => {
    expect(rosterGate({ ...base, planStatus: "draft" })).toEqual({
      action: "publish",
      enabled: true,
      reason: null,
    });
  });

  test("published plan yields revise regardless of requests and violations", () => {
    const expected = { action: "revise", enabled: true, reason: null } as const;
    expect(rosterGate({ ...base, planStatus: "published" })).toEqual(expected);
    expect(
      rosterGate({
        ...base,
        planStatus: "published",
        approvedRequestCount: 0,
        approvedSlotCount: 0,
        blockingViolationCount: 2,
      }),
    ).toEqual(expected);
  });

  test("ho (canWrite false) always gets none", () => {
    const none = { action: "none" } as const;
    for (const planStatus of [null, "draft", "published"] as const) {
      expect(rosterGate({ ...base, canWrite: false, planStatus })).toEqual(
        none,
      );
    }
    expect(
      rosterGate({
        ...base,
        canWrite: false,
        approvedRequestCount: 0,
        approvedSlotCount: 0,
      }),
    ).toEqual(none);
    expect(
      rosterGate({
        ...base,
        canWrite: false,
        planStatus: "draft",
        blockingViolationCount: 4,
      }),
    ).toEqual(none);
  });

  test("singular wording for one slot, one request and one warning", () => {
    expect(
      rosterGate({ ...base, approvedRequestCount: 1, approvedSlotCount: 4 }),
    ).toMatchObject({ reason: "4 slots from 1 request" });
    expect(
      rosterGate({ ...base, approvedRequestCount: 1, approvedSlotCount: 1 }),
    ).toMatchObject({ reason: "1 slot from 1 request" });
    expect(
      rosterGate({ ...base, approvedRequestCount: 3, approvedSlotCount: 1 }),
    ).toMatchObject({ reason: "1 slot from 3 requests" });
    expect(
      rosterGate({ ...base, approvedRequestCount: 2, approvedSlotCount: 0 }),
    ).toMatchObject({ reason: "0 slots from 2 requests" });
    expect(
      rosterGate({ ...base, planStatus: "draft", blockingViolationCount: 1 }),
    ).toMatchObject({
      reason: "1 rule warning must be resolved before publishing",
    });
  });
});
