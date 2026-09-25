CREATE TYPE "public"."search_check_status" AS ENUM('readable', 'no_access', 'check_failed');--> statement-breakpoint
CREATE TYPE "public"."index_verdict" AS ENUM('indexed', 'not_indexed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."search_breakdown" AS ENUM('total', 'device', 'query', 'page');--> statement-breakpoint
CREATE TYPE "public"."search_engine" AS ENUM('google', 'bing');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('posthog', 'google_search', 'bing_search');--> statement-breakpoint
CREATE TABLE "bing_webmaster_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_status" "search_check_status",
	"last_check_message" text,
	"backfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bing_webmaster_sites_siteId_unique" UNIQUE("site_id")
);
--> statement-breakpoint
CREATE TABLE "site_index_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"address" text NOT NULL,
	"verdict" "index_verdict" NOT NULL,
	"coverage_state" text,
	"last_crawl_at" timestamp with time zone,
	"inspected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_index_status_site_address_unique" UNIQUE("site_id","address"),
	CONSTRAINT "site_index_status_address_length" CHECK (length("site_index_status"."address") <= 500)
);
--> statement-breakpoint
CREATE TABLE "site_search_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"engine" "search_engine" NOT NULL,
	"day" date NOT NULL,
	"breakdown" "search_breakdown" NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position_sum" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_search_daily_site_engine_day_breakdown_value_unique" UNIQUE("site_id","engine","day","breakdown","value"),
	CONSTRAINT "site_search_daily_non_negative" CHECK ("site_search_daily"."clicks" >= 0 and "site_search_daily"."impressions" >= 0 and "site_search_daily"."position_sum" >= 0),
	CONSTRAINT "site_search_daily_value_length" CHECK (length("site_search_daily"."value") <= 200)
);
--> statement-breakpoint
ALTER TABLE "site_snapshot_results" DROP CONSTRAINT "site_snapshot_results_run_site_unique";--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD COLUMN "last_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD COLUMN "last_check_status" "search_check_status";--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD COLUMN "last_check_message" text;--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD COLUMN "backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "replaces_existing_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "brand_terms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "site_snapshot_results" ADD COLUMN "source" "snapshot_source" DEFAULT 'posthog' NOT NULL;--> statement-breakpoint
ALTER TABLE "bing_webmaster_sites" ADD CONSTRAINT "bing_webmaster_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_index_status" ADD CONSTRAINT "site_index_status_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_search_daily" ADD CONSTRAINT "site_search_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_index_status_site_inspected_idx" ON "site_index_status" USING btree ("site_id","inspected_at");--> statement-breakpoint
CREATE INDEX "site_search_daily_site_day_idx" ON "site_search_daily" USING btree ("site_id","day" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "site_snapshot_results" ADD CONSTRAINT "site_snapshot_results_run_site_source_unique" UNIQUE("run_id","site_id","source");