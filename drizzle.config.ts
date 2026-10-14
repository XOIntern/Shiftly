import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Bun expands ${VAR} in .env automatically, but `bun run` executes package.json
// scripts via their bin shebang (node), where dotenv/config loads DATABASE_URL
// unexpanded. Resolve template parts here so both runtimes get a usable URL.
const dbUrl = process.env.DATABASE_URL?.replace(
  /\$\{([\w]+)\}/g,
  (_match, name: string) => process.env[name] ?? "",
);

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema/index.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: dbUrl!,
  },
});
