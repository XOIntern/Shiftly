import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "../drizzle/schema";
import { db } from "./db";

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
      role: {
        type: "string",
        input: true,
        required: false, // optional at input; DB default 'site_admin' applies
      },
      siteId: {
        type: "string",
        input: true,
        required: false, // optional at input; NULL = HO
      },
      isActive: {
        type: "boolean",
        input: false,
      },
    },
  },
});
