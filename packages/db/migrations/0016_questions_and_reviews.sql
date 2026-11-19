CREATE TABLE "answers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "answers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"question_id" integer NOT NULL,
	"pull_request_id" integer NOT NULL,
	"option" integer,
	"text" text NOT NULL,
	"signed_by" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opinions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opinions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"finding_id" integer NOT NULL,
	"pull_request_id" integer NOT NULL,
	"signed_by" uuid NOT NULL,
	"value" text NOT NULL,
	"comment" text,
	"review_id" integer,
	"from_round" integer NOT NULL,
	"carried_from_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opinions_value" CHECK ("opinions"."value" in ('worth', 'not_worth'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_id" integer NOT NULL,
	"signed_by" uuid NOT NULL,
	"worth" integer NOT NULL,
	"not_worth" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"notified_task_id" text
);
--> statement-breakpoint
ALTER TABLE "decision_batches" ADD COLUMN "author_login" text;--> statement-breakpoint
ALTER TABLE "decision_batches" ADD COLUMN "author_member_id" uuid;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_signed_by_team_members_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_signed_by_team_members_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_carried_from_id_opinions_id_fk" FOREIGN KEY ("carried_from_id") REFERENCES "public"."opinions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_signed_by_team_members_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_question" ON "answers" USING btree ("question_id","id");--> statement-breakpoint
CREATE INDEX "answers_pull_request" ON "answers" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opinions_finding_signer" ON "opinions" USING btree ("finding_id","signed_by");--> statement-breakpoint
CREATE INDEX "opinions_pull_request" ON "opinions" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "reviews_pull_request" ON "reviews" USING btree ("pull_request_id","created_at");--> statement-breakpoint
ALTER TABLE "decision_batches" ADD CONSTRAINT "decision_batches_author_member_id_team_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-added (S-08): live change notifications (`pra_notify_change`, migration 0006). Keep these
-- when this migration is regenerated.
CREATE TRIGGER answers_notify_change AFTER INSERT OR UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER opinions_notify_change AFTER INSERT OR UPDATE ON opinions
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER reviews_notify_change AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();