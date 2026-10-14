export type DbErrorKind = "name" | "email" | "site-name";

const DUPLICATE_MESSAGES: Record<DbErrorKind, string> = {
  name: "A client with this name already exists",
  email: "Email already in use",
  "site-name": "A site with this name already exists for this client",
};

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
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
