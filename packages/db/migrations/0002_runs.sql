CREATE TABLE "agent_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stage_execution_id" integer NOT NULL,
	"role" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"cost_source" text NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"prompt_blob_key" text,
	"transcript_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_role" CHECK ("agent_sessions"."role" in ('reviewer', 'verifier', 'implementer', 'judge', 'analyst')),
	CONSTRAINT "agent_sessions_cost_source" CHECK ("agent_sessions"."cost_source" in ('reported', 'computed'))
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"pull_request_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"file" text NOT NULL,
	"line" integer,
	"scenario" text NOT NULL,
	"suggestion" text NOT NULL,
	"verdict" text DEFAULT 'unchecked' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_run_ordinal" UNIQUE("run_id","ordinal"),
	CONSTRAINT "findings_severity" CHECK ("findings"."severity" in ('blocking', 'worth_fixing', 'nit')),
	CONSTRAINT "findings_verdict" CHECK ("findings"."verdict" in ('confirmed', 'refuted', 'not_proven', 'unchecked'))
);
--> statement-breakpoint
CREATE TABLE "github_actions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"run_id" integer,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"result" text NOT NULL,
	"github_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"options" jsonb NOT NULL,
	"recommended" integer,
	"why" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_run_ordinal" UNIQUE("run_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"kind" text NOT NULL,
	"round_no" integer,
	"chain_id" uuid,
	"level" jsonb NOT NULL,
	"head_sha" text NOT NULL,
	"commits_count_at_start" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_by" text NOT NULL,
	"started_by_member_id" text,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"not_checked" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "runs_kind" CHECK ("runs"."kind" in ('round', 'implementer', 'trial', 'analyst')),
	CONSTRAINT "runs_status" CHECK ("runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "runs_started_by" CHECK ("runs"."started_by" in ('member', 'bot', 'hand')),
	CONSTRAINT "runs_started_by_member" CHECK (("runs"."started_by" = 'member') = ("runs"."started_by_member_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stage_executions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stage_executions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"stage" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"output" jsonb,
	"error_code" text,
	"error_detail" text,
	CONSTRAINT "stage_executions_run_stage_attempt" UNIQUE("run_id","stage","attempt"),
	CONSTRAINT "stage_executions_status" CHECK ("stage_executions"."status" in ('pending', 'running', 'succeeded', 'failed', 'off', 'reused'))
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_stage_execution_id_stage_executions_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_actions" ADD CONSTRAINT "github_actions_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_actions" ADD CONSTRAINT "github_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_executions" ADD CONSTRAINT "stage_executions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_stage_execution" ON "agent_sessions" USING btree ("stage_execution_id");--> statement-breakpoint
CREATE INDEX "findings_pull_request" ON "findings" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "github_actions_pull_request" ON "github_actions" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_pr" ON "runs" USING btree ("pull_request_id") WHERE "runs"."status" in ('queued', 'running') and "runs"."kind" in ('round', 'implementer');--> statement-breakpoint
CREATE INDEX "runs_pull_request" ON "runs" USING btree ("pull_request_id","created_at");