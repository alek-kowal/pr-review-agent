CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "github_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"repository_full_name" text,
	"pr_number" integer,
	"blob_key" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "github_events_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "instruction_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instruction_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scope" text NOT NULL,
	"repository_id" integer,
	"file_key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_versions_file_version" UNIQUE NULLS NOT DISTINCT("scope","repository_id","file_key","version"),
	CONSTRAINT "instruction_versions_scope_repository" CHECK (("instruction_versions"."scope" = 'global') = ("instruction_versions"."repository_id" is null)),
	CONSTRAINT "instruction_versions_scope" CHECK ("instruction_versions"."scope" in ('global', 'repository')),
	CONSTRAINT "instruction_versions_status" CHECK ("instruction_versions"."status" in ('active', 'draft', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"author_login" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"head_ref" text NOT NULL,
	"base_ref" text NOT NULL,
	"is_draft" boolean NOT NULL,
	"is_fork" boolean NOT NULL,
	"state" text NOT NULL,
	"commits_count" integer NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pull_requests_state" CHECK ("pull_requests"."state" in ('open', 'closed', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repositories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"github_full_name" text NOT NULL,
	"installation_id" bigint,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "repositories_github_full_name_unique" UNIQUE("github_full_name")
);
--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_versions_one_active" ON "instruction_versions" USING btree ("scope",coalesce("repository_id", 0),"file_key") WHERE "instruction_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_number" ON "pull_requests" USING btree ("repository_id","number");