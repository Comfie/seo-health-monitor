CREATE TABLE "account_deletion_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_hash" text NOT NULL,
	"tenant_hash" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_records_user_hash_unique" UNIQUE("user_hash"),
	CONSTRAINT "account_deletion_records_tenant_hash_unique" UNIQUE("tenant_hash")
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"running" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_progress_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_events_kind_time_idx" ON "operational_events" USING btree ("kind","created_at");