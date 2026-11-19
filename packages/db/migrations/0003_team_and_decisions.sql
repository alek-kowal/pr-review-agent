CREATE TABLE "decision_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "decision_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"signed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "decision_batches_decision" CHECK (decision in ('implement', 'reject', 'defer'))
);
--> statement-breakpoint
CREATE TABLE "finding_decisions" (
	"finding_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "finding_decisions_finding_id_batch_id_pk" PRIMARY KEY("finding_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"github_login" text NOT NULL,
	"clickup_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "decision_batches" ADD CONSTRAINT "decision_batches_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_batches" ADD CONSTRAINT "decision_batches_signed_by_team_members_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD CONSTRAINT "finding_decisions_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_decisions" ADD CONSTRAINT "finding_decisions_batch_id_decision_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."decision_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_batches_pull_request" ON "decision_batches" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE INDEX "finding_decisions_batch" ON "finding_decisions" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_github_login_active" ON "team_members" USING btree (lower("github_login")) WHERE "team_members"."removed_at" is null;