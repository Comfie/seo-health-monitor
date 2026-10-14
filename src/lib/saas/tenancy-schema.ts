import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  personalUserId: text("personal_user_id").unique().references(() => user.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  // Per-account administrator overrides. NULL follows the server-side beta settings (src/lib/saas/limits.ts).
  websiteLimit: integer("website_limit"),
  monthlyAuditLimit: integer("monthly_audit_limit"),
  pageLimit: integer("page_limit"),
  concurrentAuditLimit: integer("concurrent_audit_limit"),
  monthlyPagespeedLimit: integer("monthly_pagespeed_limit"),
  monthlyAiLimit: integer("monthly_ai_limit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tenant_limits_valid", sql`${t.websiteLimit} >= 0 and ${t.monthlyAuditLimit} >= 0 and ${t.pageLimit} between 1 and 100 and ${t.concurrentAuditLimit} between 1 and 10`),
  check("tenant_budget_limits_valid", sql`(${t.monthlyPagespeedLimit} is null or ${t.monthlyPagespeedLimit} between 0 and 10000) and (${t.monthlyAiLimit} is null or ${t.monthlyAiLimit} between 0 and 1000)`),
  check("tenant_status_valid", sql`${t.status} in ('active', 'suspended')`),
]);

export const memberships = pgTable("memberships", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("membership_user_idx").on(t.userId), check("membership_role_valid", sql`${t.role} in ('owner', 'member')`)]);

// Never accepted as a registration field; provisioned through an offline operator command.
export const administrators = pgTable("administrators", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Only a SHA-256 hash of the emailed token is stored. A token is claimed once at
// registration, then consumed when the verified user's personal tenant is created.
export const invitations = pgTable("beta_invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  tokenHash: text("token_hash").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  consumedBy: text("consumed_by").unique().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
