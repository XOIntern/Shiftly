import { describe, expect, test } from "bun:test";

import { pickPlan, selectedLocationFor } from "./roster-location";

const LOC_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const LOC_2 = "aaaaaaaa-2222-4222-9222-222222222222";
const LOC_3 = "aaaaaaaa-3333-4333-8333-333333333333";
const SITE = "bbbbbbbb-1111-4111-8111-111111111111";

describe("selectedLocationFor", () => {
  const locations = [
    { id: LOC_1, name: "A", siteId: SITE },
    { id: LOC_2, name: "B", siteId: SITE },
  ];

  test("an admin's pinned location always wins", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: LOC_1,
        siteLocations: locations,
        param: LOC_2,
        planLocationId: LOC_2,
      }),
    ).toBe(LOC_1);
  });

  test("a picked location in scope is used", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: LOC_2,
        planLocationId: LOC_1,
      }),
    ).toBe(LOC_2);
  });

  test("a param outside the scope is ignored", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: LOC_3,
        planLocationId: null,
      }),
    ).toBe(LOC_1);
  });

  test("a single in-scope location is selected by default", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: [locations[1]],
        param: null,
        planLocationId: null,
      }),
    ).toBe(LOC_2);
  });

  test("several locations and no pick default to the chosen plan's location", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: null,
        planLocationId: LOC_2,
      }),
    ).toBe(LOC_2);
  });

  test("several locations, no pick and no plan default to the first by name", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: null,
        planLocationId: null,
      }),
    ).toBe(LOC_1);
  });

  test("no location in scope selects nothing", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: [],
        param: LOC_1,
        planLocationId: null,
      }),
    ).toBeNull();
  });
});

describe("pickPlan", () => {
  const draft = { id: "d", status: "draft" as const };
  const published = { id: "p", status: "published" as const };

  test("the requested plan wins when it is in the list", () => {
    expect(pickPlan([draft, published], "p")).toBe(published);
  });

  test("otherwise the draft, else the first (newest) plan", () => {
    expect(pickPlan([published, draft], "missing")).toBe(draft);
    expect(pickPlan([published], null)).toBe(published);
    expect(pickPlan([], null)).toBeNull();
  });
});
