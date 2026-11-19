CREATE TABLE "sensitive_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensitive_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"path" text NOT NULL,
	"pattern" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor" text,
	"member_id" uuid,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"head_sha" text NOT NULL,
	CONSTRAINT "sensitive_files_pull_request_path" UNIQUE("pull_request_id","path"),
	CONSTRAINT "sensitive_files_status" CHECK ("sensitive_files"."status" in ('pending', 'approved', 'sent_back')),
	CONSTRAINT "sensitive_files_member" CHECK (("sensitive_files"."actor" = 'member') = ("sensitive_files"."member_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "sensitive_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sensitive_files" ADD CONSTRAINT "sensitive_files_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_files" ADD CONSTRAINT "sensitive_files_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;