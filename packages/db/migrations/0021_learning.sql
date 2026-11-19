CREATE TABLE "analyses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analyses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"run_id" integer,
	"started_by" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"candidate_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "analyses_started_by" CHECK ("analyses"."started_by" in ('bot', 'hand')),
	CONSTRAINT "analyses_status" CHECK ("analyses"."status" in ('running', 'finished', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "lesson_candidate_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lesson_candidate_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"candidate_id" integer NOT NULL,
	"pull_request_id" integer NOT NULL,
	"analysis_id" integer,
	"evidence" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_candidate_sources_pr" UNIQUE("candidate_id","pull_request_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_candidates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lesson_candidates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"pr_count" integer DEFAULT 1 NOT NULL,
	"reject_reason" text,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"lessons_version" integer,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_candidates_status" CHECK ("lesson_candidates"."status" in ('proposed', 'accepted', 'rejected')),
	CONSTRAINT "lesson_candidates_reject_reason" CHECK ("lesson_candidates"."status" <> 'rejected' or "lesson_candidates"."reject_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_candidate_sources" ADD CONSTRAINT "lesson_candidate_sources_candidate_id_lesson_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."lesson_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_candidate_sources" ADD CONSTRAINT "lesson_candidate_sources_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_candidate_sources" ADD CONSTRAINT "lesson_candidate_sources_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_candidates" ADD CONSTRAINT "lesson_candidates_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_candidates" ADD CONSTRAINT "lesson_candidates_decided_by_member_id_team_members_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_pull_request" ON "analyses" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_run" ON "analyses" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_one_by_bot" ON "analyses" USING btree ("pull_request_id") WHERE "analyses"."started_by" = 'bot';--> statement-breakpoint
CREATE INDEX "lesson_candidate_sources_analysis" ON "lesson_candidate_sources" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "lesson_candidates_repository" ON "lesson_candidates" USING btree ("repository_id","status");