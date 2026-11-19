CREATE TABLE "autofix_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "autofix_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"chain_id" uuid,
	"round_run_id" integer,
	"implementer_run_id" integer,
	"patch_id" integer,
	"point" text NOT NULL,
	"outcome" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"sha" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autofix_attempts_point" CHECK ("autofix_attempts"."point" in ('start', 'push')),
	CONSTRAINT "autofix_attempts_outcome" CHECK ("autofix_attempts"."outcome" in ('started', 'pushed', 'waiting'))
);
--> statement-breakpoint
CREATE TABLE "autofix_shadow" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "autofix_shadow_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"run_id" integer,
	"patch_id" integer,
	"level" integer NOT NULL,
	"point" text NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"fixed" integer NOT NULL,
	"total" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autofix_shadow_point" CHECK ("autofix_shadow"."point" in ('start', 'push')),
	CONSTRAINT "autofix_shadow_decision" CHECK ("autofix_shadow"."decision" in ('would_start', 'would_push', 'would_wait'))
);
--> statement-breakpoint
ALTER TABLE "decision_batches" ALTER COLUMN "signed_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_batches" ADD COLUMN "actor" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "autofix_attempts" ADD CONSTRAINT "autofix_attempts_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_attempts" ADD CONSTRAINT "autofix_attempts_chain_id_round_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."round_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_attempts" ADD CONSTRAINT "autofix_attempts_round_run_id_runs_id_fk" FOREIGN KEY ("round_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_attempts" ADD CONSTRAINT "autofix_attempts_implementer_run_id_runs_id_fk" FOREIGN KEY ("implementer_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_attempts" ADD CONSTRAINT "autofix_attempts_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_shadow" ADD CONSTRAINT "autofix_shadow_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_shadow" ADD CONSTRAINT "autofix_shadow_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_shadow" ADD CONSTRAINT "autofix_shadow_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofix_shadow" ADD CONSTRAINT "autofix_shadow_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autofix_attempts_pull_request" ON "autofix_attempts" USING btree ("pull_request_id","at");--> statement-breakpoint
CREATE INDEX "autofix_attempts_chain" ON "autofix_attempts" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "autofix_attempts_patch" ON "autofix_attempts" USING btree ("patch_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "autofix_attempts_round_start" ON "autofix_attempts" USING btree ("round_run_id") WHERE "autofix_attempts"."point" = 'start';--> statement-breakpoint
CREATE INDEX "autofix_shadow_pull_request" ON "autofix_shadow" USING btree ("pull_request_id","at");--> statement-breakpoint
CREATE INDEX "autofix_shadow_repository" ON "autofix_shadow" USING btree ("repository_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "autofix_shadow_run_start" ON "autofix_shadow" USING btree ("run_id") WHERE "autofix_shadow"."point" = 'start';--> statement-breakpoint
CREATE UNIQUE INDEX "autofix_shadow_patch_push" ON "autofix_shadow" USING btree ("patch_id") WHERE "autofix_shadow"."point" = 'push';--> statement-breakpoint
ALTER TABLE "decision_batches" ADD CONSTRAINT "decision_batches_signer" CHECK (("decision_batches"."actor" = 'member') = ("decision_batches"."signed_by" is not null) and "decision_batches"."actor" in ('member', 'bot'));