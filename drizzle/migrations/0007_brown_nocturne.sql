CREATE TYPE "public"."roster_rule_key" AS ENUM('C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"site_id" uuid,
	"site_location_id" uuid,
	"details" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_rule_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" "roster_rule_key" NOT NULL,
	"site_id" uuid,
	"site_location_id" uuid,
	"int_value" integer,
	"bool_value" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "roster_rule_config_location_requires_site" CHECK (site_location_id is null or site_id is not null)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_site_location_id_site_location_id_fk" FOREIGN KEY ("site_location_id") REFERENCES "public"."site_location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_rule_config" ADD CONSTRAINT "roster_rule_config_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_rule_config" ADD CONSTRAINT "roster_rule_config_site_location_id_site_location_id_fk" FOREIGN KEY ("site_location_id") REFERENCES "public"."site_location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_rule_config_global_rule_key_unique" ON "roster_rule_config" USING btree ("rule_key") WHERE site_id is null and site_location_id is null and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_rule_config_site_rule_key_unique" ON "roster_rule_config" USING btree ("site_id","rule_key") WHERE site_id is not null and site_location_id is null and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_rule_config_site_location_rule_key_unique" ON "roster_rule_config" USING btree ("site_location_id","rule_key") WHERE site_location_id is not null and deleted_at is null;