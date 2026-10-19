ALTER TABLE "worker" ADD CONSTRAINT "worker_id_site_id_unique" UNIQUE("id","site_id");--> statement-breakpoint
CREATE TABLE "worker_position" (
	"worker_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "worker_position_worker_id_position_id_pk" PRIMARY KEY("worker_id","position_id")
);
--> statement-breakpoint
ALTER TABLE "worker_position" ADD CONSTRAINT "worker_position_worker_site_fk" FOREIGN KEY ("worker_id","site_id") REFERENCES "public"."worker"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_position" ADD CONSTRAINT "worker_position_position_site_fk" FOREIGN KEY ("position_id","site_id") REFERENCES "public"."position"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_position_position_id_idx" ON "worker_position" USING btree ("position_id");--> statement-breakpoint
INSERT INTO "worker_position" ("worker_id","position_id","site_id")
	SELECT "id","position_id","site_id" FROM "worker";
