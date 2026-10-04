CREATE TABLE IF NOT EXISTS "vehicle_positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"driver_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_vehicle_time_idx" ON "vehicle_positions" USING btree ("vehicle_id","device_time");