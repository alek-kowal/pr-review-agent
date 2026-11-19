ALTER TABLE "pull_requests" ADD COLUMN "ci_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "ci_checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "changes_requested_by" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "checks_refreshed_at" timestamp with time zone;