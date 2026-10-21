import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { db } from "./db";

const { user } = schema;

// Better Auth resolves email/password sign-in through
// internalAdapter.findUserByEmail, which queries the adapter's findOne with
// only `email = ?` — no deleted_at filter and no ORDER BY
// (@better-auth/drizzle-adapter findOne / better-auth
// dist/db/internal-adapter.mjs findUserByEmail). Once a soft-deleted row and
// a live row may share an email (the partial unique index allows exactly
// that), sign-in could resolve the deleted row's account and fail with
// "Invalid password" or FORBIDDEN — breaking the "emails of deleted rows are
// reusable" contract. The wrapper resolves a user lookup to the LIVE row
// whenever one matches; when only a deleted row matches (plain sign-in to a
// deleted account) it falls back to the original lookup so the session hook
// below still answers FORBIDDEN with the generic inactive message. All other
// models and methods delegate untouched.
const liveUsersOnly =
  (adapter: ReturnType<typeof drizzleAdapter>) => (options: BetterAuthOptions) => {
    const instance = adapter(options);
    return {
      ...instance,
      findOne: async (args: Parameters<typeof instance.findOne>[0]) => {
        if (args.model !== "user") return instance.findOne(args);
        // `{ value: null }` is what the adapter's where-clause transform
        // maps to `IS NULL`, so the clause rides the normal path instead of
        // bypassing schema-aware field resolution.
        const live = await instance.findOne({
          ...args,
          where: [
            ...(args.where ?? []),
            { field: "deletedAt", value: null, connector: "AND" },
          ],
        });
        if (live !== null) return live;
        return instance.findOne(args);
      },
    };
  };

export const auth = betterAuth({
  database: liveUsersOnly(drizzleAdapter(db, { provider: "pg", schema })),
  emailAndPassword: {
    enabled: true,
    // Better Auth 1.7.7 supports this option (enforced in
    // dist/api/routes/sign-up.mjs: `emailAndPassword?.disableSignUp`);
    // users are provisioned by HO instead of self sign-up.
    disableSignUp: true,
    // Backstop for any direct Better Auth API path; OWASP no-MFA minimum
    // (Better Auth 1.7.7 create-context.mjs:186 defaults it to 8 otherwise).
    minPasswordLength: 15,
  },
  // Explicit, not default-dependent: window 10s, max 100, memory storage.
  // Better Auth's built-in special rules already throttle /sign-in and
  // /change-password to 3 req / 10s (dist/api/rate-limiter/index.mjs
  // getDefaultSpecialRules). Enabled in dev too, so dev and prod behave
  // identically. Memory storage is per-instance — revisit when scaling
  // horizontally. Behind a reverse proxy the limiter keys on the client IP
  // from x-forwarded-for/x-real-ip — the proxy must set those or every
  // client shares one bucket.
  rateLimit: { enabled: true },
  user: {
    additionalFields: {
      // All additional fields are guarded with `input: false`: provisioning
      // writes rows directly (app/dashboard/users/actions.ts,
      // scripts/seed-admin.ts) and reads happen fresh from the DB
      // (lib/session.ts). `input: true` here would let any logged-in user
      // grant themselves `role: "superadmin"` via /api/auth/update-user
      // (Better Auth 1.7.7 dist/db/schema.mjs parseInputData copies every
      // body key whose field is not `input: false`).
      role: {
        type: "string",
        input: false,
        required: false, // DB default 'admin' applies
      },
      // Scope matrix (docs/architecture.md v0.2 §6): superadmin NULL/NULL
      // (global), ho siteId set / siteLocationId NULL (site only), admin
      // siteId NULL / siteLocationId set (location only).
      siteId: {
        type: "string",
        input: false,
        required: false, // superadmin: NULL (global); ho: the user's site
      },
      siteLocationId: {
        type: "string",
        input: false,
        required: false, // superadmin/ho: NULL; admin: the user's site_location
      },
      isActive: {
        type: "boolean",
        input: false,
      },
      // Only here so the adapter's where-clause transform accepts the
      // `deletedAt IS NULL` clause the liveUsersOnly wrapper appends —
      // fields unknown to the Better Auth schema are rejected before ever
      // reaching drizzle. The column itself stays managed by provisioning
      // and the deleteUser action; `input: false` keeps it that way.
      deletedAt: {
        type: "date",
        input: false,
        required: false, // live rows: NULL
      },
    },
  },
  // Deactivated users must not be able to mint new sessions. The hook runs
  // after password verification, so the FORBIDDEN response leaks nothing to
  // unauthenticated callers — and throwing an APIError (instead of returning
  // `false`, which Better Auth maps to the generic FAILED_TO_CREATE_SESSION)
  // is what surfaces the real reason to the login form.
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          if (!session.userId) return true;
          const [row] = await db
            .select({ isActive: user.isActive, deletedAt: user.deletedAt })
            .from(user)
            .where(eq(user.id, session.userId))
            .limit(1);
          // A soft-deleted user (GitHub #38) must not sign in even though
          // isActive may still be true. Same generic message as the
          // inactive branch — no account-status leak.
          if (row?.deletedAt != null) {
            throw new APIError("FORBIDDEN", {
              message: "Your account is inactive.",
            });
          }
          if (row?.isActive !== true) {
            throw new APIError("FORBIDDEN", {
              message: "Your account is inactive.",
            });
          }
          return true;
        },
      },
    },
  },
});
