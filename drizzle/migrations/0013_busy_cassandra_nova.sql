CREATE TABLE "worker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"employee_id" text NOT NULL,
	"name" text NOT NULL,
	"position_id" uuid NOT NULL,
	"contract_end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_id_site_id_unique" UNIQUE("id","site_id");--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_position_site_fk" FOREIGN KEY ("position_id","site_id") REFERENCES "public"."position"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_site_location_id_employee_id_unique" ON "worker" USING btree ("site_location_id","employee_id") WHERE deleted_at is null;