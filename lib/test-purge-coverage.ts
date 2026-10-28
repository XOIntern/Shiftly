import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import type { PurgeCoverage } from "@/types/deleted";

import { db } from "./db";

// Read-only: compares what a permanent delete removes, refuses on, or loses
// through ON DELETE CASCADE with the foreign keys of the REAL migrated schema.
// A table added later that points at one of them fails here, while its author
// can still decide what the permanent delete should do with it.

type Fk = { child: string; parent: string; deltype: string };

async function foreignKeys(): Promise<Fk[]> {
  const result = await db.execute<Fk>(sql`
    select cc.relname as child, pc.relname as parent, c.confdeltype::text as deltype
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid
    join pg_class pc on pc.oid = c.confrelid
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  return result.rows;
}

// One message per foreign-key child that references a purged or history table
// and is listed in no group. purgeFn is the entity's purge function, named in
// the message so the author knows where to add the delete step.
export async function purgeCoverageOffenders(
  coverage: PurgeCoverage,
  purgeFn = "purgeSiteGuarded",
): Promise<string[]> {
  const purged = new Set(coverage.purged);
  const history = new Set(coverage.history);
  const covered = new Set([...purged, ...history, ...coverage.cascade]);

  return (await foreignKeys())
    .filter((fk) => (purged.has(fk.parent) || history.has(fk.parent)) && !covered.has(fk.child))
    .map(
      (fk) =>
        `${fk.child} -> ${fk.parent}: add a delete step or a history guard to ${purgeFn} and list the table in PURGE_COVERAGE`,
    );
}

export function describePurgeCoverage(
  label: string,
  coverage: PurgeCoverage,
  purgeFn?: string,
): void {
  const purged = new Set(coverage.purged);
  const history = new Set(coverage.history);
  const cascade = new Set(coverage.cascade);
  const covered = new Set([...purged, ...history, ...cascade]);

  describe(label, () => {
    test("every table that references a purged or history table is covered", async () => {
      expect(await purgeCoverageOffenders(coverage, purgeFn)).toEqual([]);
    });

    test("every table listed as cascading really cascades from a covered table", async () => {
      const fks = await foreignKeys();

      for (const table of cascade) {
        const cascades = fks.some(
          (fk) =>
            fk.child === table &&
            fk.deltype === "c" &&
            (purged.has(fk.parent) || history.has(fk.parent)),
        );
        expect(cascades, `${table} is listed as cascading but has no ON DELETE CASCADE foreign key to a purged or history table`).toBe(true);
      }
    });

    test("every listed table exists", async () => {
      for (const table of covered) {
        const found = await db.execute(
          sql`select 1 from pg_class where relname = ${table} and relnamespace = 'public'::regnamespace and relkind = 'r'`,
        );
        expect(found.rows, `${table} is listed in PURGE_COVERAGE but is not a table`).toHaveLength(1);
      }
    });

    test("a table is listed in only one group", () => {
      const all = [...coverage.purged, ...coverage.history, ...coverage.cascade];

      expect(new Set(all).size).toBe(all.length);
    });
  });
}
