CREATE TABLE "finding_verifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "finding_verifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"finding_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"verdict" text NOT NULL,
	"reason" jsonb NOT NULL,
	"verifier_verdict" text,
	"verifier_reason" text,
	"dropped_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remedy" jsonb,
	"script" text,
	"exit_code" integer,
	"timed_out" boolean DEFAULT false NOT NULL,
	"output_tail" text,
	"output_blob_key" text,
	"repaired" boolean DEFAULT false NOT NULL,
	"sandbox_runs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_verifications_finding" UNIQUE("finding_id"),
	CONSTRAINT "finding_verifications_verdict" CHECK ("finding_verifications"."verdict" in ('confirmed', 'refuted', 'not_proven', 'unchecked'))
);
--> statement-breakpoint
ALTER TABLE "finding_verifications" ADD CONSTRAINT "finding_verifications_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_verifications" ADD CONSTRAINT "finding_verifications_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_verifications_run" ON "finding_verifications" USING btree ("run_id");