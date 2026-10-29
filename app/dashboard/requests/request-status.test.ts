import { describe, expect, test } from "bun:test";

import type { MpRequestRow } from "@/types/mp-request";

import { isRequestMutable } from "./request-status";

const base: MpRequestRow = {
  id: "rq-1",
  type: "weekly",
  status: "approved",
  weekStart: "2026-11-02",
  requestDate: null,
  siteLocationId: "loc-1",
  siteName: "Site",
  locationName: "Loc",
  lines: [],
  updatedAt: "2026-10-27T00:00:00.000Z",
  rosterLocked: false,
};

const daily = (status: MpRequestRow["status"]): MpRequestRow => ({
  ...base,
  type: "daily",
  status,
  weekStart: null,
  requestDate: "2026-11-03",
});

describe("isRequestMutable", () => {
  test("a daily request is mutable only while open", () => {
    expect(isRequestMutable(daily("open"))).toBeTrue();
    for (const status of [
      "approved",
      "fulfilled",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(isRequestMutable(daily(status))).toBeFalse();
    }
  });

  test("an approved weekly is mutable until its week has a roster plan", () => {
    expect(isRequestMutable(base)).toBeTrue();
    expect(isRequestMutable({ ...base, rosterLocked: true })).toBeFalse();
  });

  test("a weekly that is not approved is never mutable", () => {
    for (const status of [
      "open",
      "fulfilled",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(isRequestMutable({ ...base, status })).toBeFalse();
    }
  });
});
