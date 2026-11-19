ALTER TABLE "instruction_versions" DROP CONSTRAINT "instruction_versions_repository_id_repositories_id_fk";
--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP COLUMN "scope";--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP COLUMN "repository_id";--> statement-breakpoint
ALTER TABLE "instruction_versions" DROP COLUMN "file_key";