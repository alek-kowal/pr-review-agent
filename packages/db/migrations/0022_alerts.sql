CREATE TABLE "alert_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"failed_on" boolean DEFAULT true NOT NULL,
	"rounds_on" boolean DEFAULT true NOT NULL,
	"cost_on" boolean DEFAULT true NOT NULL,
	"cost_max_usd" numeric(12, 2) DEFAULT 5 NOT NULL,
	"budget_on" boolean DEFAULT true NOT NULL,
	"budget_percent" integer DEFAULT 80 NOT NULL,
	"general_task_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_config_single_row" CHECK ("alert_config"."id" = 1),
	CONSTRAINT "alert_config_cost_positive" CHECK ("alert_config"."cost_max_usd" > 0),
	CONSTRAINT "alert_config_budget_percent" CHECK ("alert_config"."budget_percent" in (50, 70, 80, 90))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"pull_request_id" integer,
	"run_id" integer,
	"title" jsonb NOT NULL,
	"next_step" jsonb NOT NULL,
	"clickup_task_id" text,
	"to_general_task" boolean DEFAULT false NOT NULL,
	"comment_id" text,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"posted_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"end_note" jsonb,
	CONSTRAINT "alerts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_status" ON "alerts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alerts_pull_request" ON "alerts" USING btree ("pull_request_id","status");--> statement-breakpoint
-- S-18-T2 (hand-written; keep when this migration is regenerated): the alert config row exists
-- after migrate, with the defaults ($5, 80%).
INSERT INTO "alert_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Live updates (S-03-T1): alert changes reach the board, the status chip and Activity over SSE.
CREATE TRIGGER alerts_notify_change AFTER INSERT OR UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();