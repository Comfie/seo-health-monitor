-- Stage 3: fenced job leases, usage kinds and nullable per-account limit overrides. Additive:
-- no rows are deleted or rewritten. Existing tenants keep their explicit limit values as overrides.
ALTER TABLE "tenants" ALTER COLUMN "website_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "website_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "monthly_audit_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "monthly_audit_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "page_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "page_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "concurrent_audit_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "concurrent_audit_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_pagespeed_limit" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_ai_limit" integer;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "kind" text DEFAULT 'audit' NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "fence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "kind" text DEFAULT 'audit' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "job_active_idx" ON "background_jobs" USING btree ("tenant_id","audit_id","kind") WHERE "background_jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "job_audit_lookup_idx" ON "background_jobs" USING btree ("tenant_id","audit_id");--> statement-breakpoint
DROP INDEX "job_audit_idx";--> statement-breakpoint
CREATE INDEX "usage_kind_idx" ON "usage_records" USING btree ("tenant_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "usage_global_idx" ON "usage_records" USING btree ("kind","created_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenant_budget_limits_valid" CHECK (("tenants"."monthly_pagespeed_limit" is null or "tenants"."monthly_pagespeed_limit" between 0 and 10000) and ("tenants"."monthly_ai_limit" is null or "tenants"."monthly_ai_limit" between 0 and 1000));--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "job_kind_valid" CHECK ("background_jobs"."kind" in ('audit', 'pagespeed'));--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "job_attempts_valid" CHECK ("background_jobs"."attempts" >= 0 and "background_jobs"."max_attempts" between 1 and 10 and "background_jobs"."fence" >= 0);--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_kind_valid" CHECK ("usage_records"."kind" in ('audit', 'pagespeed', 'ai') and "usage_records"."units" between 1 and 1000);