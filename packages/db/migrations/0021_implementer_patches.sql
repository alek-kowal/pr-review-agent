CREATE TABLE "implementer_requests" (
	"run_id" integer PRIMARY KEY NOT NULL,
	"finding_ids" jsonb NOT NULL,
	"revises_patch_id" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "patch_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "patch_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"patch_id" integer NOT NULL,
	"path" text NOT NULL,
	"base_blob_key" text,
	"blob_key" text,
	"status" text DEFAULT 'changed' NOT NULL,
	CONSTRAINT "patch_files_path" UNIQUE("patch_id","path"),
	CONSTRAINT "patch_files_status" CHECK ("patch_files"."status" in ('changed', 'edited', 'reverted'))
);
--> statement-breakpoint
CREATE TABLE "patches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "patches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"base_sha" text NOT NULL,
	"revision" integer NOT NULL,
	"finding_ids" jsonb NOT NULL,
	"fixed_finding_ids" jsonb NOT NULL,
	"reproductions" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"revise_note" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"checking" boolean DEFAULT false NOT NULL,
	"check_version" integer DEFAULT 0 NOT NULL,
	"started_by" text NOT NULL,
	"started_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patches_run" UNIQUE("run_id"),
	CONSTRAINT "patches_revision" UNIQUE("pull_request_id","revision"),
	CONSTRAINT "patches_status" CHECK ("patches"."status" in ('ready', 'superseded', 'pushed', 'discarded'))
);
--> statement-breakpoint
ALTER TABLE "implementer_requests" ADD CONSTRAINT "implementer_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "implementer_requests" ADD CONSTRAINT "implementer_requests_revises_patch_id_patches_id_fk" FOREIGN KEY ("revises_patch_id") REFERENCES "public"."patches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patch_files" ADD CONSTRAINT "patch_files_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patches" ADD CONSTRAINT "patches_started_by_member_id_team_members_id_fk" FOREIGN KEY ("started_by_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patches_pull_request" ON "patches" USING btree ("pull_request_id","revision");--> statement-breakpoint
-- Hand-added (S-13-T2): live change notifications (`pra_notify_change`, migration 0006). File
-- edits also touch their patch row, so one trigger covers both tables. Keep this when the
-- migration is regenerated.
CREATE TRIGGER patches_notify_change AFTER INSERT OR UPDATE ON patches
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();