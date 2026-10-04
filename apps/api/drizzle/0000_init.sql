CREATE TABLE IF NOT EXISTS "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"dow" integer NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"is_payday" boolean NOT NULL,
	"festival" text,
	"festival_ramp" double precision NOT NULL,
	"is_holiday" boolean NOT NULL,
	"monsoon" boolean NOT NULL,
	"is_operating" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deferrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"rule" text,
	"detail" text NOT NULL,
	"repeat_skip" boolean DEFAULT false NOT NULL,
	"deferred_to" date NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delay_stats" (
	"district" text NOT NULL,
	"seq" integer NOT NULL,
	"mean_min" double precision NOT NULL,
	"sd_min" double precision NOT NULL,
	"n" integer NOT NULL,
	CONSTRAINT "delay_stats_district_seq_pk" PRIMARY KEY("district","seq")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"stop_id" uuid,
	"driver_id" uuid,
	"vehicle_id" text,
	"outcome" text NOT NULL,
	"delivered_units" integer NOT NULL,
	"receiver_name" text,
	"photo_id" uuid,
	"note" text,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_version" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demand_history" (
	"depot" text NOT NULL,
	"brand" text NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"total_m3" double precision NOT NULL,
	"chilled_m3" double precision NOT NULL,
	"orders" integer NOT NULL,
	CONSTRAINT "demand_history_depot_brand_iso_year_iso_week_pk" PRIMARY KEY("depot","brand","iso_year","iso_week")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_sync" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_sync_at" timestamp with time zone NOT NULL,
	"plan_version_seen" integer,
	"pending" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "districts" (
	"district" text PRIMARY KEY NOT NULL,
	"depot" text NOT NULL,
	"road_class" text NOT NULL,
	"free_flow_kmh" double precision NOT NULL,
	"depot_to_district_km" double precision NOT NULL,
	"depot_to_district_min" integer NOT NULL,
	"inter_stop_km" double precision NOT NULL,
	"inter_stop_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"actor_role" text,
	"type" text NOT NULL,
	"date" date,
	"plan_version" integer,
	"scope" jsonb NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"trip_id" uuid,
	"order_id" uuid,
	"raised_by" uuid,
	"role" text NOT NULL,
	"item" text,
	"qty" integer,
	"note" text,
	"photo_id" uuid,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_ledger" (
	"vehicle_id" text NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"litres" double precision NOT NULL,
	CONSTRAINT "fuel_ledger_vehicle_id_iso_year_iso_week_pk" PRIMARY KEY("vehicle_id","iso_year","iso_week")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"trip_id" uuid,
	"vehicle_id" text NOT NULL,
	"reported_by" uuid,
	"device_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"options" jsonb,
	"chosen_option" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" text NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text NOT NULL,
	"outlet_id" text NOT NULL,
	"brand" text NOT NULL,
	"district" text NOT NULL,
	"depot" text NOT NULL,
	"temp" text NOT NULL,
	"requested_date" date NOT NULL,
	"units" integer NOT NULL,
	"weight_kg" double precision NOT NULL,
	"volume_m3" double precision NOT NULL,
	"status" text NOT NULL,
	"placed_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"after_cutoff" boolean DEFAULT false NOT NULL,
	"deferred_yesterday" boolean DEFAULT false NOT NULL,
	"days_since_last_served" integer DEFAULT 1 NOT NULL,
	"note" text,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"district" text NOT NULL,
	"depot" text NOT NULL,
	"dock_type" text NOT NULL,
	"parking_constraint" text NOT NULL,
	"mall_window_open" integer,
	"mall_window_close" integer,
	"window_open" integer NOT NULL,
	"window_close" integer NOT NULL,
	"access_notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"bottleneck" jsonb,
	"stats" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "plans_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"temp" text NOT NULL,
	"weight_kg" double precision NOT NULL,
	"volume_m3" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"status" text NOT NULL,
	"received_units" integer,
	"note" text,
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "road_conditions" (
	"district" text NOT NULL,
	"date" date NOT NULL,
	"disruption_index" double precision NOT NULL,
	CONSTRAINT "road_conditions_district_date_pk" PRIMARY KEY("district","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_allowances" (
	"brand" text NOT NULL,
	"dock_type" text NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "service_allowances_brand_dock_type_pk" PRIMARY KEY("brand","dock_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"planned_arrival" integer,
	"late_risk" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"loaded_units" integer,
	"load_checked_at" timestamp with time zone,
	CONSTRAINT "stops_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_speed" (
	"district" text NOT NULL,
	"hour" integer NOT NULL,
	"monsoon" boolean NOT NULL,
	"speed_index" double precision NOT NULL,
	CONSTRAINT "traffic_speed_district_hour_monsoon_pk" PRIMARY KEY("district","hour","monsoon")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_no" integer NOT NULL,
	"brand" text NOT NULL,
	"district" text NOT NULL,
	"depot" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_depart" integer,
	"planned_return" integer,
	"minutes" integer,
	"km" double precision,
	"fuel_l" double precision,
	"checks" jsonb,
	"released_at" timestamp with time zone,
	"released_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"outlet_id" text,
	"vehicle_id" text,
	"depot" text,
	"phone" text,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"temp" text NOT NULL,
	"weight_cap_kg" double precision NOT NULL,
	"volume_cap_m3" double precision NOT NULL,
	"fuel_type" text NOT NULL,
	"km_per_l" double precision NOT NULL,
	"weekly_fuel_quota_l" double precision NOT NULL,
	"depot" text NOT NULL,
	"plate" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deferrals_order_date" ON "deferrals" USING btree ("order_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_date_idx" ON "events" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_outlet_idx" ON "notifications" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_date_idx" ON "orders" USING btree ("requested_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_outlet_idx" ON "orders" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stops_trip_idx" ON "stops" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trips_plan_vehicle_no" ON "trips" USING btree ("plan_id","vehicle_id","trip_no");