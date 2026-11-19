CREATE TABLE "finding_fix_checks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "finding_fix_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"finding_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"resolved" boolean NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_fix_checks_finding_run" UNIQUE("finding_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "round_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" integer NOT NULL,
	"expected_head_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensitive_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensitive_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"path" text NOT NULL,
	"pattern" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor" text,
	"member_id" uuid,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"head_sha" text NOT NULL,
	CONSTRAINT "sensitive_files_pull_request_path" UNIQUE("pull_request_id","path"),
	CONSTRAINT "sensitive_files_status" CHECK ("sensitive_files"."status" in ('pending', 'approved', 'sent_back')),
	CONSTRAINT "sensitive_files_member" CHECK (("sensitive_files"."actor" = 'member') = ("sensitive_files"."member_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "sensitive_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "commits_since" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "commits_since_head" text;--> statement-breakpoint
ALTER TABLE "finding_fix_checks" ADD CONSTRAINT "finding_fix_checks_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_fix_checks" ADD CONSTRAINT "finding_fix_checks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_chains" ADD CONSTRAINT "round_chains_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_files" ADD CONSTRAINT "sensitive_files_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_files" ADD CONSTRAINT "sensitive_files_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_fix_checks_run" ON "finding_fix_checks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "round_chains_pull_request" ON "round_chains" USING btree ("pull_request_id","created_at");--> statement-breakpoint
-- Chains of rounds created before this migration.
INSERT INTO "round_chains" ("id", "pull_request_id", "created_at")
SELECT DISTINCT ON ("chain_id") "chain_id", "pull_request_id", "created_at" FROM "runs"
WHERE "chain_id" IS NOT NULL ORDER BY "chain_id", "created_at" ON CONFLICT DO NOTHING;