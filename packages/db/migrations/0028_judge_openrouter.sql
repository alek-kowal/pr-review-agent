ALTER TABLE "agent_sessions" ADD COLUMN "provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "answered_model" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_provider" CHECK ("agent_sessions"."provider" in ('anthropic', 'openrouter'));