CREATE TABLE "round_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" integer NOT NULL,
	"expected_head_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "round_chains" ADD CONSTRAINT "round_chains_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_chains_pull_request" ON "round_chains" USING btree ("pull_request_id","created_at");--> statement-breakpoint
-- Chains of rounds created before this migration.
INSERT INTO "round_chains" ("id", "pull_request_id", "created_at")
SELECT DISTINCT ON ("chain_id") "chain_id", "pull_request_id", "created_at" FROM "runs"
WHERE "chain_id" IS NOT NULL ORDER BY "chain_id", "created_at" ON CONFLICT DO NOTHING;
