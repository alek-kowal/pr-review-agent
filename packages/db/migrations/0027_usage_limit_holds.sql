CREATE TABLE "usage_limit_holds" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"resets_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
