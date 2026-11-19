CREATE TABLE "run_waits" (
	"run_id" integer PRIMARY KEY NOT NULL,
	"admitted_at" timestamp with time zone,
	"reason" jsonb,
	"waiting_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_waits" ADD CONSTRAINT "run_waits_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- S-10: the single app settings row (pause, budget, agent slots, time zone) exists after migrate;
-- an empty object reads as the defaults (agent slots 2).
INSERT INTO "app_settings" ("id", "settings") VALUES (1, '{}'::jsonb) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE TRIGGER run_waits_notify_change AFTER INSERT OR UPDATE ON run_waits
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();--> statement-breakpoint
CREATE TRIGGER app_settings_notify_change AFTER INSERT OR UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();