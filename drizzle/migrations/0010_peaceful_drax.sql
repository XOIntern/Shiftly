ALTER TABLE "work_area" DROP CONSTRAINT "work_area_department_site_fk";--> statement-breakpoint
ALTER TABLE "work_area" DROP COLUMN "department_id";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_department_id_department_id_fk";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "department_id";--> statement-breakpoint
DROP TABLE "department" CASCADE;
