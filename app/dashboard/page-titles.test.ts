import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every dashboard page names itself with one h1 on the shared v3 title
// style (page-title); the old per-page text-2xl font-semibold string must
// not creep back.
const FILES = [
  "positions/page.tsx",
  "workers/page.tsx",
  "sites/page.tsx",
  "users/page.tsx",
  "requests/page.tsx",
  "requests/new/page.tsx",
  "requests/[id]/edit/page.tsx",
  "locations/page.tsx",
  "work-areas/page.tsx",
  "settings/page.tsx",
  "attendance/page.tsx",
  "roster/roster-week-view.tsx",
  "page.tsx",
];

describe("dashboard page titles", () => {
  for (const file of FILES) {
    test(`${file} has an h1 using page-title`, () => {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      const tags = source.match(/<h1[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag).toContain("page-title");
        expect(tag).not.toContain("text-2xl");
      }
    });
  }
});
