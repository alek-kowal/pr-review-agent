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
ALTER TABLE "finding_fix_checks" ADD CONSTRAINT "finding_fix_checks_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_fix_checks" ADD CONSTRAINT "finding_fix_checks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_fix_checks_run" ON "finding_fix_checks" USING btree ("run_id");