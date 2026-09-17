CREATE TYPE "public"."analytics_ownership" AS ENUM('open_waters', 'client_owned');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('onboarding', 'active', 'paused', 'offboarded');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('ok', 'unauthorised', 'project_not_found', 'error');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('GBP', 'EUR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."figure_source" AS ENUM('client_confirmed', 'open_waters_estimate');--> statement-breakpoint
CREATE TYPE "public"."posthog_region" AS ENUM('eu', 'us');--> statement-breakpoint
CREATE TYPE "public"."site_change_kind" AS ENUM('launch', 'design', 'content', 'campaign', 'experiment', 'tracking');--> statement-breakpoint
CREATE TYPE "public"."site_framework" AS ENUM('astro', 'next', 'other');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "client_status" DEFAULT 'onboarding' NOT NULL,
	"analytics_ownership" "analytics_ownership" NOT NULL,
	"regulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "posthog_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"region" "posthog_region" NOT NULL,
	"project_id" integer NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"key_version" integer NOT NULL,
	"key_last4" text NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_status" "connection_status",
	"last_check_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posthog_connections_siteId_unique" UNIQUE("site_id")
);
--> statement-breakpoint
CREATE TABLE "report_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_recipients_client_email_unique" UNIQUE("client_id","email")
);
--> statement-breakpoint
CREATE TABLE "search_console_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"property" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_console_properties_siteId_unique" UNIQUE("site_id")
);
--> statement-breakpoint
CREATE TABLE "site_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" "site_change_kind" NOT NULL,
	"title" varchar(120) NOT NULL,
	"detail" text,
	"expected_effect" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_commercial_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"lead_value_minor" integer,
	"currency" "currency",
	"lead_to_customer_rate" numeric(5, 4),
	"source" "figure_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_commercial_context_siteId_unique" UNIQUE("site_id"),
	CONSTRAINT "site_commercial_context_source_required" CHECK (("site_commercial_context"."lead_value_minor" is null and "site_commercial_context"."lead_to_customer_rate" is null) or "site_commercial_context"."source" is not null),
	CONSTRAINT "site_commercial_context_currency_required" CHECK ("site_commercial_context"."lead_value_minor" is null or "site_commercial_context"."currency" is not null),
	CONSTRAINT "site_commercial_context_rate_range" CHECK ("site_commercial_context"."lead_to_customer_rate" is null or ("site_commercial_context"."lead_to_customer_rate" >= 0 and "site_commercial_context"."lead_to_customer_rate" <= 1)),
	CONSTRAINT "site_commercial_context_value_non_negative" CHECK ("site_commercial_context"."lead_value_minor" is null or "site_commercial_context"."lead_value_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_expected_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_expected_events_site_event_unique" UNIQUE("site_id","event")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"production_url" text NOT NULL,
	"framework" "site_framework" NOT NULL,
	"repository" text,
	"launched_on" date,
	"taxonomy_version" integer NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_productionUrl_unique" UNIQUE("production_url")
);
--> statement-breakpoint
ALTER TABLE "posthog_connections" ADD CONSTRAINT "posthog_connections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_recipients" ADD CONSTRAINT "report_recipients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_properties" ADD CONSTRAINT "search_console_properties_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_commercial_context" ADD CONSTRAINT "site_commercial_context_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_expected_events" ADD CONSTRAINT "site_expected_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_recipients_client_id_idx" ON "report_recipients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "site_changes_site_occurred_idx" ON "site_changes" USING btree ("site_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sites_client_id_idx" ON "sites" USING btree ("client_id");