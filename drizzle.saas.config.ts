import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/saas/schema.ts", "./src/lib/saas/auth-schema.ts", "./src/lib/saas/tenancy-schema.ts", "./src/lib/saas/operations-schema.ts"],
  out: "./drizzle-saas",
  dbCredentials: { url: process.env.STAGING_DATABASE_URL ?? "postgresql://localhost/seo_phase2_staging" },
  strict: true,
});
