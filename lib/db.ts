import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";

export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), {
  schema,
});

// What read-only loaders need from a database handle: the pool-backed `db` or
// a transaction's `tx`. A loader that takes one runs on the caller's
// connection instead of asking the pool for another.
export type DbExecutor = Pick<typeof db, "select">;
