import {
  DbErrorKind,
  DUPLICATE_MESSAGES,
  REFERENCE_CODES,
  MAX_CAUSE_DEPTH,
} from "@/types/db-error";

export function pgErrorCode(
  err: unknown,
  depth = 0,
  seen = new Set<object>(),
): string | undefined {
  if (
    typeof err !== "object" ||
    err === null ||
    depth > MAX_CAUSE_DEPTH ||
    seen.has(err as object)
  ) {
    return undefined;
  }
  seen.add(err as object);
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;

  const cause = (err as { cause?: unknown }).cause;
  if (cause) return pgErrorCode(cause, depth + 1, seen);

  return undefined;
}

// Same walk for a Postgres error's constraint name, so actions can route
// FK violations (23503 may fire on several FKs of one statement, e.g. the
// user table's site/location/work-area bindings) to per-constraint
// messages.
export function pgErrorConstraint(
  err: unknown,
  depth = 0,
  seen = new Set<object>(),
): string | undefined {
  if (
    typeof err !== "object" ||
    err === null ||
    depth > MAX_CAUSE_DEPTH ||
    seen.has(err as object)
  ) {
    return undefined;
  }
  seen.add(err as object);
  const constraint = (err as { constraint?: unknown }).constraint;
  if (typeof constraint === "string") return constraint;

  const cause = (err as { cause?: unknown }).cause;
  if (cause) return pgErrorConstraint(cause, depth + 1, seen);

  return undefined;
}

// Maps a Postgres error received from the driver to a user-facing message.
// Returns null for anything unexpected — the caller should fall back to its
// generic error handler.
export function mapDbError(
  err: unknown,
  { kind }: { kind: DbErrorKind },
): string | null {
  const code = pgErrorCode(err);
  if (!code) return null;

  if (code === "23505") return DUPLICATE_MESSAGES[kind];
  if (REFERENCE_CODES.has(code))
    return "Some records still reference this item";
  return null;
}
