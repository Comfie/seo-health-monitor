CREATE TABLE "google_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"browser_hash" text NOT NULL,
	"encrypted_verifier" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_console_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"site_id" integer NOT NULL,
	"requested_by" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"fence" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gsc_job_state_valid" CHECK ("search_console_jobs"."state" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "gsc_job_attempts_valid" CHECK ("search_console_jobs"."attempts" >= 0 and "search_console_jobs"."max_attempts" between 1 and 10 and "search_console_jobs"."fence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "google_subject" text;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "google_accounts" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "search_console_connections" ADD COLUMN "permission_level" text;--> statement-breakpoint
ALTER TABLE "search_console_connections" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "search_console_connections" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "google_oauth_states" ADD CONSTRAINT "google_oauth_states_tenant_id_user_id_memberships_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_jobs" ADD CONSTRAINT "search_console_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_jobs" ADD CONSTRAINT "search_console_jobs_tenant_id_site_id_sites_tenant_id_id_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_oauth_states_expiry_idx" ON "google_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_job_active_idx" ON "search_console_jobs" USING btree ("tenant_id","site_id") WHERE "search_console_jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "gsc_job_claim_idx" ON "search_console_jobs" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "gsc_job_site_idx" ON "search_console_jobs" USING btree ("tenant_id","site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_tenant_idx" ON "google_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "google_accounts_subject_idx" ON "google_accounts" USING btree ("google_subject");--> statement-breakpoint
CREATE INDEX "snapshots_audit_idx" ON "search_snapshots" USING btree ("tenant_id","audit_id");--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_status_valid" CHECK ("google_accounts"."status" in ('active', 'revoked'));