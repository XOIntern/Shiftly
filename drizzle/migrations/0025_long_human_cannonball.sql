CREATE TYPE "public"."attendance_status" AS ENUM('present', 'leave', 'sick', 'absent');--> statement-breakpoint
CREATE TABLE "attendance_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_definition_id" uuid NOT NULL,
	"work_area_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"without_roster" boolean DEFAULT false NOT NULL,
	"rostered_shift_definition_id" uuid,
	"reason" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_record_worker_date_unique" UNIQUE("worker_id","date"),
	CONSTRAINT "attendance_record_without_roster_check" CHECK (without_roster = (rostered_shift_definition_id is null))
);
--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_worker_site_fk" FOREIGN KEY ("worker_id","site_id") REFERENCES "public"."worker"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_shift_definition_weld_fk" FOREIGN KEY ("shift_definition_id","site_location_id","site_id") REFERENCES "public"."shift_definition"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_rostered_shift_weld_fk" FOREIGN KEY ("rostered_shift_definition_id","site_location_id","site_id") REFERENCES "public"."shift_definition"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_work_area_weld_fk" FOREIGN KEY ("work_area_id","site_location_id","site_id") REFERENCES "public"."work_area"("id","site_location_id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_recorded_by_user_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_record_location_date_idx" ON "attendance_record" USING btree ("site_location_id","date");