CREATE TABLE "head_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "head_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"github_event_id" integer,
	"before_sha" text NOT NULL,
	"after_sha" text NOT NULL,
	"pusher" text,
	"by_bot" boolean NOT NULL,
	"is_base_merge" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "head_changes_github_event" UNIQUE("github_event_id")
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "merge_sha" text;--> statement-breakpoint
ALTER TABLE "head_changes" ADD CONSTRAINT "head_changes_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "head_changes" ADD CONSTRAINT "head_changes_github_event_id_github_events_id_fk" FOREIGN KEY ("github_event_id") REFERENCES "public"."github_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "head_changes_pull_request" ON "head_changes" USING btree ("pull_request_id","at","id");