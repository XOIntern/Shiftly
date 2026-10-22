CREATE TABLE "shift_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_location_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"label" text NOT NULL,
	"order_index" smallint NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "shift_definition_id_site_location_id_site_id_unique" UNIQUE("id","site_location_id","site_id")
);
--> statement-breakpoint
-- Hand-edited: dropped drizzle-kit's spurious roster_rule_key enum
-- round-trip (ALTER to text / DROP TYPE / CREATE TYPE / re-ALTER). 0017
-- was hand-written without a snapshot, so generate diffed against the
-- stale 0016 snapshot and re-emitted the already-applied C8→C7 fix.
-- The live DB already has roster_rule_key = ('C1'..'C7'), which is exactly
-- what the new 0018 snapshot records, so removing these statements leaves
-- snapshot lineage and DB state consistent.--> statement-breakpoint
ALTER TABLE "shift_definition" ADD CONSTRAINT "shift_definition_site_location_site_fk" FOREIGN KEY ("site_location_id","site_id") REFERENCES "public"."site_location"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definition_site_location_id_order_index_unique" ON "shift_definition" USING btree ("site_location_id","order_index") WHERE deleted_at is null;