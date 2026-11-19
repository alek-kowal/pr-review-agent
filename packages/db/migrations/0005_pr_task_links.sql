CREATE TABLE "pr_task_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pr_task_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"task_id" text NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"how" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_task_links_pull_request_id_unique" UNIQUE("pull_request_id"),
	CONSTRAINT "pr_task_links_how" CHECK ("pr_task_links"."how" in ('branch', 'title', 'search', 'hand')),
	CONSTRAINT "pr_task_links_linked_by" CHECK ("pr_task_links"."linked_by" in ('member', 'bot', 'hand')),
	CONSTRAINT "pr_task_links_linked_by_member" CHECK (("pr_task_links"."linked_by" = 'member') = ("pr_task_links"."linked_by_member_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pr_task_links" ADD CONSTRAINT "pr_task_links_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;