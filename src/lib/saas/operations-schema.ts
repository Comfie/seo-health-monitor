import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { audits } from "./schema";
import { tenants } from "./tenancy-schema";

/**
 * Durable work queue. A claim increments `fence` and issues a fresh `lease_token`;
 * every write a worker makes (progress, results, failure) must present both while the
 * job is still `running`, so an expired or superseded worker can never overwrite a
 * retry's results. `tenant_id` is copied from the audit at admission and is the only
 * tenant identity a worker uses.
 */
export const jobs = pgTable("background_jobs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  auditId: integer("audit_id").notNull(),
  kind: text("kind", { enum: ["audit", "pagespeed"] }).notNull().default("audit"),
  state: text("state", { enum: ["queued", "running", "completed", "failed", "cancelled"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  fence: integer("fence").notNull().default(0),
  leaseToken: text("lease_token"),
  lockedBy: text("locked_by"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  requestedBy: text("requested_by"),
  // Admission-time snapshot (page limit, PageSpeed sample size); never read from the request.
  payload: jsonb("payload").$type<JobPayload>().notNull().default({}),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"),
  // At most one active job of each kind per audit; finished jobs stay as history.
  uniqueIndex("job_active_idx").on(t.tenantId, t.auditId, t.kind).where(sql`${t.state} in ('queued', 'running')`),
  index("job_audit_lookup_idx").on(t.tenantId, t.auditId),
  index("job_claim_idx").on(t.state, t.availableAt),
  check("job_state_valid", sql`${t.state} in ('queued', 'running', 'completed', 'failed', 'cancelled')`),
  check("job_kind_valid", sql`${t.kind} in ('audit', 'pagespeed')`),
  check("job_attempts_valid", sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 10 and ${t.fence} >= 0`),
]);

export type JobPayload = { maxPages?: number; pagespeedPages?: number };

/**
 * Append-only usage ledger for operational quotas. Rows survive website/audit deletion so
 * deleting data never resets a quota. `kind` separates audits, PageSpeed tests and AI calls.
 */
export const usageRecords = pgTable("usage_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  auditId: integer("audit_id").notNull(),
  kind: text("kind", { enum: ["audit", "pagespeed", "ai"] }).notNull().default("audit"),
  units: integer("units").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("usage_month_idx").on(t.tenantId, t.createdAt),
  index("usage_kind_idx").on(t.tenantId, t.kind, t.createdAt),
  index("usage_global_idx").on(t.kind, t.createdAt),
  check("usage_kind_valid", sql`${t.kind} in ('audit', 'pagespeed', 'ai') and ${t.units} between 1 and 1000`),
]);

export const activity = pgTable("account_activity", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  // Only explicit, non-secret metadata. No passwords, tokens or crawled content.
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activity_tenant_idx").on(t.tenantId, t.createdAt)]);

export const imports = pgTable("sqlite_imports", {
  sourceSha256: text("source_sha256").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "restrict" }),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

// Fixed-code events only. No free-text payloads, URLs, credentials or report content.
export const operationalEvents = pgTable("operational_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("operational_events_kind_time_idx").on(t.kind, t.createdAt)]);

export const systemHeartbeats = pgTable("system_heartbeats", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["web", "worker"] }).notNull(),
  running: integer("running").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
});

// No FK: survives erasure. Hashes of random identifiers, never email/password/token hashes.
// Also exported to the restricted deletion ledger before any backup is restored.
export const deletionRecords = pgTable("account_deletion_records", {
  id: text("id").primaryKey(),
  userHash: text("user_hash").notNull().unique(),
  tenantHash: text("tenant_hash").notNull().unique(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});
