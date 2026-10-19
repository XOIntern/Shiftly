export type DbErrorKind = "email" | "site-name" | "location-name" | "work-area-name";

export const DUPLICATE_MESSAGES: Record<DbErrorKind, string> = {
  email: "Email already in use",
  "site-name": "A site with this name already exists",
  "location-name": "Location name already exists",
  "work-area-name": "Work area name already exists",
};

// Both codes mean "still referenced" to a user: 23503 is the generic FK
// violation, while Postgres raises 23001 (restrict_violation) specifically
// for ON DELETE RESTRICT constraints (verified against the dev DB — see
// lib/location-fk.test.ts).
export const REFERENCE_CODES = new Set(["23503", "23001"]);

// Drizzle 0.45 wraps the driver's PG error as `cause` (DrizzleQueryError),
// so the code may be a level or two below the error object we receive. Walk
// the cause chain, bounded by depth and a visited guard against cycles.
export const MAX_CAUSE_DEPTH = 4;
