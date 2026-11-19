ALTER TABLE "runs" ADD COLUMN "retry_of" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancelled_by_member_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "stage_executions" ADD COLUMN "reused_from_stage_id" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_runs_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_executions" ADD CONSTRAINT "stage_executions_reused_from_stage_id_stage_executions_id_fk" FOREIGN KEY ("reused_from_stage_id") REFERENCES "public"."stage_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_cancelled_by" CHECK ("runs"."cancelled_by" in ('member', 'bot', 'hand'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_cancel_reason" CHECK ("runs"."cancel_reason" in ('by_hand', 'pr_closed'));