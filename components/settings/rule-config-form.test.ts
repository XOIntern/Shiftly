import { describe, expect, test } from "bun:test";

import { splitRuleFieldErrors } from "./rule-config-form";

// The dialog renders error slots for scope, siteLocationId, intValue and
// boolValue only. A refusal keyed to a field the form never renders — the
// null-bound ho's siteId ("Site is required.") — must lift into the message
// slot instead of vanishing, matching the user-form convention.
describe("rule dialog field-error routing", () => {
  test("a siteId refusal lifts into the message slot", () => {
    const split = splitRuleFieldErrors({ siteId: "Site is required." });

    expect(split.message).toBe("Site is required.");
    expect(split.fieldErrors.siteId).toBeUndefined();
  });

  test("rendered field keys stay in the per-field map", () => {
    const split = splitRuleFieldErrors({
      scope: "HO accounts change their own site's rules.",
      siteLocationId: "Location is required.",
      intValue: "Must be between 1 and 7.",
      boolValue: "Value is required.",
    });

    expect(split.message).toBeUndefined();
    expect(split.fieldErrors).toEqual({
      scope: "HO accounts change their own site's rules.",
      siteLocationId: "Location is required.",
      intValue: "Must be between 1 and 7.",
      boolValue: "Value is required.",
    });
  });

  test("form-level errors stay rendered; mixed bags split both ways", () => {
    const split = splitRuleFieldErrors({
      form: "Bad payload.",
      siteId: "Site is required.",
      intValue: "Value is required.",
    });

    expect(split.fieldErrors.form).toBe("Bad payload.");
    expect(split.fieldErrors.intValue).toBe("Value is required.");
    expect(split.message).toBe("Site is required.");
  });
});
