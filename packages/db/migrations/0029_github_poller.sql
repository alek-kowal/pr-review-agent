CREATE TABLE "github_poll_pull_requests" (
	"repository_id" integer NOT NULL,
	"number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"is_draft" boolean NOT NULL,
	"state" text NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_poll_pull_requests_repository_id_number_pk" PRIMARY KEY("repository_id","number")
);
--> statement-breakpoint
CREATE TABLE "github_poll_repositories" (
	"repository_id" integer PRIMARY KEY NOT NULL,
	"baseline_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_poller" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_error" jsonb,
	"backoff_until" timestamp with time zone,
	"rate_limit" jsonb,
	CONSTRAINT "github_poller_single_row" CHECK ("github_poller"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "github_poll_pull_requests" ADD CONSTRAINT "github_poll_pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_poll_repositories" ADD CONSTRAINT "github_poll_repositories_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;