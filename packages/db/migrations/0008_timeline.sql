CREATE TABLE "pr_state_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pr_state_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"state" text NOT NULL,
	"lane" text,
	"reason" jsonb NOT NULL,
	"head_sha" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_state_changes_state" CHECK (state in ('merged', 'closed', 'queued', 'round_running', 'fix_check_running', 'fixing', 'stage_failed', 'draft', 'never_reviewed', 'new_commits', 'patch_ready', 'questions_waiting', 'findings_to_decide', 'sensitive_files', 'waiting_for_fix', 'rounds_used', 'ready_to_merge'))
);
--> statement-breakpoint
CREATE TABLE "timeline_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timeline_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"member_id" uuid,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" integer,
	"cost_usd" numeric(12, 6),
	"source_key" text NOT NULL,
	CONSTRAINT "timeline_entries_source" UNIQUE("pull_request_id","source_key"),
	CONSTRAINT "timeline_entries_actor" CHECK (actor in ('member', 'bot', 'hand')),
	CONSTRAINT "timeline_entries_member" CHECK (("timeline_entries"."actor" = 'member') = ("timeline_entries"."member_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "instruction_versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_state_changes" ADD CONSTRAINT "pr_state_changes_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_state_changes_pull_request" ON "pr_state_changes" USING btree ("pull_request_id","at","id");--> statement-breakpoint
CREATE INDEX "timeline_entries_pull_request" ON "timeline_entries" USING btree ("pull_request_id","at","id");--> statement-breakpoint
-- Hand-written (S-03-T5): both tables notify like the others (`pra_notify_change`, migration 0006).
CREATE TRIGGER timeline_entries_notify_change AFTER INSERT OR UPDATE ON timeline_entries
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER pr_state_changes_notify_change AFTER INSERT OR UPDATE ON pr_state_changes
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
