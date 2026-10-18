export type DbErrorKind =
  | "email"
  | "site-name"
  | "location-name"
  | "department-name"
  | "work-area-name";

const DUPLICATE_MESSAGES: Record<DbErrorKind, string> = {
  email: "Email already in use",
  "site-name": "A site with this name already exists",
  "location-name": "Location name already exists",
  "department-name": "Department name already exists",
  "work-area-name": "Work area name already exists",
};

// Both codes mean "still referenced" to a user: 23503 is the generic FK
// violation, while Postgres raises 23001 (restrict_violation) specifically
// for ON DELETE RESTRICT constraints (verified against the dev DB — see
// lib/location-fk.test.ts).
const REFERENCE_CODES = new Set(["23503", "23001"]);

// Drizzle 0.45 wraps the driver's PG error as `cause` (DrizzleQueryError),
// so the code may be a level or two below the error object we receive. Walk
// the cause chain, bounded by depth and a visited guard against cycles.
const MAX_CAUSE_DEPTH = 4;

// Walks the cause chain and returns the first string `code` found (or
// undefined), so server actions can distinguish specific codes
// (e.g. FK violation 23503) that mapDbError doesn't special-case per field.
export function pgErrorCode(
  err: unknown,
  depth = 0,
  seen = new Set<object>(),
): string | undefined {
  if (typeof err !== "object" || err === null || depth > MAX_CAUSE_DEPTH || seen.has(err as object)) {
    return undefined;
  }
  seen.add(err as object);
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;

  const cause = (err as { cause?: unknown }).cause;
  if (cause) return pgErrorCode(cause, depth + 1, seen);

  return undefined;
}

// Maps a Postgres error received from the driver to a user-facing message.
// Returns null for anything unexpected — the caller should fall back to its
// generic error handler.
export function mapDbError(err: unknown, { kind }: { kind: DbErrorKind }): string | null {
  const code = pgErrorCode(err);
  if (!code) return null;

  if (code === "23505") return DUPLICATE_MESSAGES[kind];
  if (REFERENCE_CODES.has(code)) return "Some records still reference this item";
  return null;
}
