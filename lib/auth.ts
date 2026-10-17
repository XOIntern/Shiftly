import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { db } from "./db";

const { user } = schema;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    // Better Auth 1.7.7 supports this option (enforced in
    // dist/api/routes/sign-up.mjs: `emailAndPassword?.disableSignUp`);
    // users are provisioned by HO instead of self sign-up.
    disableSignUp: true,
  },
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
