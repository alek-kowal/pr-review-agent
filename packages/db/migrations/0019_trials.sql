CREATE TABLE "trials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"draft_version_id" integer NOT NULL,
	"head_sha" text NOT NULL,
	"run_a_id" integer,
	"run_b_id" integer,
	"started_by" text DEFAULT 'hand' NOT NULL,
	"started_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_started_by" CHECK ("trials"."started_by" in ('member', 'bot', 'hand'))
);
--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_draft_version_id_instruction_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."instruction_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_run_a_id_runs_id_fk" FOREIGN KEY ("run_a_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_run_b_id_runs_id_fk" FOREIGN KEY ("run_b_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_started_by_member_id_team_members_id_fk" FOREIGN KEY ("started_by_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trials_pull_request" ON "trials" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "trials_run_a" ON "trials" USING btree ("run_a_id");--> statement-breakpoint
CREATE INDEX "trials_run_b" ON "trials" USING btree ("run_b_id");