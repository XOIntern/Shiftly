-- Approved data reset (epic #135): position_id is NOT NULL with no legacy
-- "any position" semantics, so existing demand is wiped; lines cascade.
DELETE FROM "mp_request";--> statement-breakpoint
ALTER TABLE "mp_request_line" DROP CONSTRAINT "mp_request_line_request_work_area_shift_date_unique";--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD COLUMN "position_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_position_site_fk" FOREIGN KEY ("position_id","site_id") REFERENCES "public"."position"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_work_area_position_weld_fk" FOREIGN KEY ("work_area_id","position_id") REFERENCES "public"."work_area_position"("work_area_id","position_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mp_request_line" ADD CONSTRAINT "mp_request_line_request_work_area_shift_position_date_unique" UNIQUE("request_id","work_area_id","shift_definition_id","position_id","date");