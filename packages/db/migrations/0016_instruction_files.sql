CREATE TABLE "instruction_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instruction_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" text NOT NULL,
	"repository_id" integer,
	"level" integer,
	"file_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_files_scope_key" UNIQUE NULLS NOT DISTINCT("scope","repository_id","level","file_key"),
	CONSTRAINT "instruction_files_scope" CHECK ("instruction_files"."scope" in ('global', 'repository', 'level')),
	CONSTRAINT "instruction_files_scope_target" CHECK (("instruction_files"."scope" = 'repository') = ("instruction_files"."repository_id" is not null) and ("instruction_files"."scope" = 'level') = ("instruction_files"."level" is not null)),
	CONSTRAINT "instruction_files_level" CHECK ("instruction_files"."level" is null or "instruction_files"."level" between 1 and 6)
);
--> statement-breakpoint
CREATE TABLE "run_instruction_versions" (
	"run_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	CONSTRAINT "run_instruction_versions_run_id_version_id_pk" PRIMARY KEY("run_id","version_id")
);
--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP CONSTRAINT "instruction_versions_file_version";--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP CONSTRAINT "instruction_versions_scope_repository";--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP CONSTRAINT "instruction_versions_scope";--> statement-breakpoint
DROP INDEX "instruction_versions_one_active";--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "file_id" integer;--> statement-breakpoint
-- Hand-written (P-17): existing versions get their file before file_id becomes required.
INSERT INTO "instruction_files" ("scope", "repository_id", "file_key")
  SELECT DISTINCT "scope", "repository_id", "file_key" FROM "instruction_versions";--> statement-breakpoint
UPDATE "instruction_versions" v SET "file_id" = f."id" FROM "instruction_files" f
  WHERE f."scope" = v."scope" AND f."repository_id" IS NOT DISTINCT FROM v."repository_id"
    AND f."level" IS NULL AND f."file_key" = v."file_key";--> statement-breakpoint
ALTER TABLE "instruction_versions" ALTER COLUMN "file_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "created_by" text DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "created_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "activated_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "instruction_versions" SET "activated_at" = "created_at" WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "instruction_files" ADD CONSTRAINT "instruction_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_instruction_versions" ADD CONSTRAINT "run_instruction_versions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_instruction_versions" ADD CONSTRAINT "run_instruction_versions_version_id_instruction_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."instruction_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_instruction_versions_version" ON "run_instruction_versions" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_file_id_instruction_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."instruction_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_created_by_member_id_team_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_activated_by_member_id_team_members_id_fk" FOREIGN KEY ("activated_by_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_versions_one_active" ON "instruction_versions" USING btree ("file_id") WHERE "instruction_versions"."status" = 'active';--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_file_version" UNIQUE("file_id","version");