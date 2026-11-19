ALTER TABLE "patches" ADD COLUMN "pushed_sha" text;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "push_refusal" jsonb;