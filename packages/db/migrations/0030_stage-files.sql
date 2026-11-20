CREATE TABLE "stage_file_choices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stage_file_choices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer,
	"stage" text NOT NULL,
	"prompt" text,
	"rules" text,
	"documents" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_file_choices_target" UNIQUE NULLS NOT DISTINCT("repository_id","stage"),
	CONSTRAINT "stage_file_choices_stage" CHECK (stage in ('change_type', 'review', 'verify', 'implement', 'analyst')),
	CONSTRAINT "stage_file_choices_documents" CHECK ("stage_file_choices"."documents" is null or jsonb_typeof("stage_file_choices"."documents") = 'array')
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "stage_files" jsonb;--> statement-breakpoint
ALTER TABLE "instruction_files" ADD COLUMN "kind" text DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_file_choices" ADD CONSTRAINT "stage_file_choices_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_files" ADD CONSTRAINT "instruction_files_kind" CHECK ("instruction_files"."kind" in ('instruction', 'document'));--> statement-breakpoint
-- Hand-written (STAGEFILES): prompts and rules are instructions, everything else stays a document
-- (core `defaultKindOf`). Keep this statement when the migration is regenerated.
UPDATE "instruction_files" SET "kind" = 'instruction' WHERE "file_key" ~ '(^|/)prompt-[^/]*\.md$' OR "file_key" ~ '-rules\.md$';