export type DbErrorKind = "name" | "email" | "site-name";

const DUPLICATE_MESSAGES: Record<DbErrorKind, string> = {
  name: "A client with this name already exists",
  email: "Email already in use",
  "site-name": "A site with this name already exists for this client",
};

// Drizzle 0.45 wraps the driver's PG error as `cause` (DrizzleQueryError),
// so the code may be a level or two below the error object we receive. Walk
// the cause chain, bounded by depth and a visited guard against cycles.
const MAX_CAUSE_DEPTH = 4;

function pgErrorCode(err: unknown, depth = 0, seen = new Set<object>()): string | undefined {
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
  if (code === "23503") return "Some records still reference this item";
  return null;
}
