CREATE TYPE "public"."roster_plan_kind" AS ENUM('weekly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."roster_plan_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "work_area_position" (
	"work_area_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"site_location_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_area_position_work_area_id_position_id_pk" PRIMARY KEY("work_area_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "roster_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"work_area_id" uuid NOT NULL,
	"shift_definition_id" uuid NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "roster_assignment_plan_worker_date_unique" UNIQUE("plan_id","worker_id","date")
);
--> statement-breakpoint
CREATE TABLE "roster_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "roster_plan_kind" NOT NULL,
	"week_start" date,
	"request_date" date,
	"status" "roster_plan_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"source_request_id" uuid,
	"generated_by" text,
	"published_at" timestamp,
	"published_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roster_plan_exactly_one_anchor" CHECK ((kind = 'weekly' and week_start is not null and request_date is null and extract(dow from week_start) = 1) or (kind = 'daily' and request_date is not null and week_start is null))
);
--> statement-breakpoint
ALTER TABLE "work_area_position" ADD CONSTRAINT "work_area_position_work_area_weld_fk" FOREIGN KEY ("work_area_id","site_location_id","site_id") REFERENCES "public"."work_area"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_area_position" ADD CONSTRAINT "work_area_position_position_site_fk" FOREIGN KEY ("position_id","site_id") REFERENCES "public"."position"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."roster_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_worker_site_fk" FOREIGN KEY ("worker_id","site_id") REFERENCES "public"."worker"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_work_area_weld_fk" FOREIGN KEY ("work_area_id","site_location_id","site_id") REFERENCES "public"."work_area"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD CONSTRAINT "roster_assignment_shift_definition_weld_fk" FOREIGN KEY ("shift_definition_id","site_location_id","site_id") REFERENCES "public"."shift_definition"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_plan" ADD CONSTRAINT "roster_plan_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_plan" ADD CONSTRAINT "roster_plan_source_request_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."mp_request"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_plan" ADD CONSTRAINT "roster_plan_generated_by_user_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_plan" ADD CONSTRAINT "roster_plan_published_by_user_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_area_position_position_id_idx" ON "work_area_position" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "roster_assignment_plan_work_area_date_idx" ON "roster_assignment" USING btree ("plan_id","work_area_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_plan_weekly_draft_unique" ON "roster_plan" USING btree ("site_location_id","week_start") WHERE kind = 'weekly' and status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "roster_plan_daily_unique" ON "roster_plan" USING btree ("site_location_id","request_date") WHERE kind = 'daily';