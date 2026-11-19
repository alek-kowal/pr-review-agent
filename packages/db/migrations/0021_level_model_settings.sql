CREATE TABLE "level_settings" (
	"level" integer PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "level_settings_level" CHECK (level in (1, 2, 3, 4, 5, 6)),
	CONSTRAINT "level_settings_object" CHECK (jsonb_typeof("level_settings"."settings") = 'object')
);
--> statement-breakpoint
CREATE TABLE "model_settings" (
	"role" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_settings_role" CHECK (role in ('reviewer', 'verifier', 'implementer', 'judge', 'analyst'))
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "models" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- Hand-written (S-21-T1): the defaults. Levels start with no own values; models per role take
-- core DEFAULT_MODELS, or a model already set in app_settings.models, which moves here.
INSERT INTO "level_settings" ("level") VALUES (1), (2), (3), (4), (5), (6) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "model_settings" ("role", "model")
SELECT d.role, COALESCE(NULLIF(trim(s.settings -> 'models' ->> d.role), ''), d.model)
FROM (VALUES
  ('reviewer', 'claude-opus-5-5'),
  ('verifier', 'claude-sonnet-5-5'),
  ('implementer', 'claude-opus-5-5'),
  ('judge', 'claude-haiku-5-5'),
  ('analyst', 'claude-sonnet-5-5')
) AS d(role, model)
LEFT JOIN "app_settings" s ON s.id = 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "app_settings" SET "settings" = "settings" - 'models';