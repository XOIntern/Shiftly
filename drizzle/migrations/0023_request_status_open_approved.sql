ALTER TYPE "public"."mp_request_status" RENAME TO "mp_request_status_old";--> statement-breakpoint
CREATE TYPE "public"."mp_request_status" AS ENUM('open','approved','fulfilled','rejected');--> statement-breakpoint
DROP INDEX "mp_request_weekly_open_unique";--> statement-breakpoint
DROP INDEX "mp_request_daily_open_unique";--> statement-breakpoint
ALTER TABLE "mp_request" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "mp_request" ALTER COLUMN "status" TYPE "public"."mp_request_status" USING (CASE "status"::text WHEN 'submitted' THEN 'open' WHEN 'received' THEN 'approved' WHEN 'processing' THEN 'approved' ELSE "status"::text END)::"public"."mp_request_status";--> statement-breakpoint
ALTER TABLE "mp_request" ALTER COLUMN "status" SET DEFAULT 'open';--> statement-breakpoint
DROP TYPE "public"."mp_request_status_old";--> statement-breakpoint
CREATE UNIQUE INDEX "mp_request_weekly_open_unique" ON "mp_request" USING btree ("site_location_id","week_start") WHERE type = 'weekly' and status in ('open','approved');--> statement-breakpoint
CREATE UNIQUE INDEX "mp_request_daily_open_unique" ON "mp_request" USING btree ("site_location_id","request_date") WHERE type = 'daily' and status in ('open','approved');
