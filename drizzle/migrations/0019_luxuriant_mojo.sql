CREATE TYPE "public"."mp_request_status" AS ENUM('submitted', 'received', 'processing', 'fulfilled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."mp_request_type" AS ENUM('weekly', 'daily');--> statement-breakpoint
CREATE TABLE "mp_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"type" "mp_request_type" NOT NULL,
	"status" "mp_request_status" DEFAULT 'submitted' NOT NULL,
	"week_start" date,
	"request_date" date,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mp_request_exactly_one_anchor" CHECK ((type = 'weekly' and week_start is not null and request_date is null and extract(dow from week_start) = 1) or (type = 'daily' and request_date is not null and week_start is null))
);
--> statement-breakpoint
CREATE TABLE "mp_request_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_area_id" uuid NOT NULL,
	"shift_definition_id" uuid NOT NULL,
	"date" date NOT NULL,
	"headcount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mp_request_line_request_work_area_shift_date_unique" UNIQUE("request_id","work_area_id","shift_definition_id","date"),
	CONSTRAINT "mp_request_line_headcount_range" CHECK (headcount between 1 and 999)
);
--> statement-breakpoint
ALTER TABLE "mp_request" ADD CONSTRAINT "mp_request_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_request" ADD CONSTRAINT "mp_request_created_by_user_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."mp_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: moved the work_area composite unique BEFORE the weld FKs —
-- drizzle-kit emitted it as the last statement, but the
-- mp_request_line_work_area_weld_fk constraint cannot be created until
-- work_area exposes (id, site_location_id, site_id) as a unique key (the
-- migrate run fails with "no unique constraint matching given keys").
-- No data changes; pure statement reordering.
ALTER TABLE "work_area" ADD CONSTRAINT "work_area_id_site_location_id_site_id_unique" UNIQUE("id","site_location_id","site_id");--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_work_area_weld_fk" FOREIGN KEY ("work_area_id","site_location_id","site_id") REFERENCES "public"."work_area"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_shift_definition_weld_fk" FOREIGN KEY ("shift_definition_id","site_location_id","site_id") REFERENCES "public"."shift_definition"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mp_request_weekly_open_unique" ON "mp_request" USING btree ("site_location_id","week_start") WHERE type = 'weekly' and status in ('submitted','received','processing');--> statement-breakpoint
CREATE UNIQUE INDEX "mp_request_daily_open_unique" ON "mp_request" USING btree ("site_location_id","request_date") WHERE type = 'daily' and status in ('submitted','received','processing');--> statement-breakpoint
CREATE INDEX "mp_request_line_request_id_idx" ON "mp_request_line" USING btree ("request_id");