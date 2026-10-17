ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";--> statement-breakpoint
ALTER TABLE "site" DROP CONSTRAINT "site_name_unique";--> statement-breakpoint
ALTER TABLE "site_location" DROP CONSTRAINT "site_location_site_id_name_unique";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "site_location" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "site_name_unique" ON "site" USING btree ("name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "site_location_site_id_name_unique" ON "site_location" USING btree ("site_id","name") WHERE deleted_at is null;