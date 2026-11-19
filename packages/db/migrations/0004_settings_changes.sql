CREATE TABLE "settings_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "settings_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"area" text NOT NULL,
	"entity" text NOT NULL,
	"actor" text NOT NULL,
	"signer_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	CONSTRAINT "settings_changes_actor" CHECK (actor in ('member', 'bot', 'hand')),
	CONSTRAINT "settings_changes_signer" CHECK (("settings_changes"."actor" = 'member') = ("settings_changes"."signer_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "settings_changes" ADD CONSTRAINT "settings_changes_signer_id_team_members_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settings_changes_at" ON "settings_changes" USING btree ("at");--> statement-breakpoint
CREATE INDEX "settings_changes_area_entity" ON "settings_changes" USING btree ("area","entity","at");