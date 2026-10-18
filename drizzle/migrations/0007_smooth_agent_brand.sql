CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "department_id_site_id_unique" UNIQUE("id","site_id")
);
--> statement-breakpoint
CREATE TABLE "work_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_location" ADD CONSTRAINT "site_location_id_site_id_unique" UNIQUE("id","site_id");--> statement-breakpoint
ALTER TABLE "work_area" ADD CONSTRAINT "work_area_department_site_fk" FOREIGN KEY ("department_id","site_id") REFERENCES "public"."department"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_area" ADD CONSTRAINT "work_area_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_site_id_name_unique" ON "department" USING btree ("site_id","name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_area_site_location_id_name_unique" ON "work_area" USING btree ("site_location_id","name") WHERE deleted_at is null;