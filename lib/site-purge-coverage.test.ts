import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { db } from "./db";
import { PURGE_COVERAGE } from "./site-purge";

// Read-only: compares what purgeSiteGuarded deletes, refuses on, or loses
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

const purged = new Set(PURGE_COVERAGE.purged);
const history = new Set(PURGE_COVERAGE.history);
const cascade = new Set(PURGE_COVERAGE.cascade);
const covered = new Set([...purged, ...history, ...cascade]);

describe("purge coverage", () => {
  test("every table that references a purged or history table is covered", async () => {
    const offenders = (await foreignKeys())
      .filter((fk) => (purged.has(fk.parent) || history.has(fk.parent)) && !covered.has(fk.child))
      .map(
        (fk) =>
          `${fk.child} -> ${fk.parent}: add a delete step or a history guard to purgeSiteGuarded and list the table in PURGE_COVERAGE`,
      );

    expect(offenders).toEqual([]);
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
    const all = [
      ...PURGE_COVERAGE.purged,
      ...PURGE_COVERAGE.history,
      ...PURGE_COVERAGE.cascade,
    ];

    expect(new Set(all).size).toBe(all.length);
  });
});
