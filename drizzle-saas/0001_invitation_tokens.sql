ALTER TABLE "beta_invitations" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "beta_invitations" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beta_invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beta_invitations" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "beta_invitations" ADD CONSTRAINT "beta_invitations_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_invitations" ADD CONSTRAINT "beta_invitations_token_hash_unique" UNIQUE("token_hash");