ALTER TABLE "client" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "site" DROP CONSTRAINT "site_client_id_client_id_fk";--> statement-breakpoint
DROP TABLE "client" CASCADE;--> statement-breakpoint
ALTER TABLE "site" DROP CONSTRAINT "site_client_id_name_unique";--> statement-breakpoint
ALTER TABLE "site" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "site" DROP COLUMN "location";--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_name_unique" UNIQUE("name");