ALTER TABLE "finding_decisions" ADD COLUMN "follow_up_status" text;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD COLUMN "follow_up_task_id" text;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD COLUMN "follow_up_url" text;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD COLUMN "follow_up_error" jsonb;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD CONSTRAINT "finding_decisions_follow_up_status" CHECK (follow_up_status in ('creating', 'created', 'failed'));--> statement-breakpoint
-- Hand-written (S-06-T5): a follow-up task's progress notifies like the others
-- (`pra_notify_change`, migration 0006); the row names no PR, so the web refreshes findings.
CREATE TRIGGER finding_decisions_notify_change AFTER UPDATE OF follow_up_status ON finding_decisions
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
