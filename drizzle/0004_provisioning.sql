CREATE TYPE "public"."measurement_tier" AS ENUM('essentials', 'insights', 'growth');--> statement-breakpoint
CREATE TYPE "public"."provisioned_kind" AS ENUM('dashboard', 'insight');--> statement-breakpoint
CREATE TYPE "public"."provisioning_kind" AS ENUM('check', 'apply');--> statement-breakpoint
CREATE TYPE "public"."provisioning_outcome" AS ENUM('matched', 'differs', 'applied', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "posthog_provisioned_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"kind" "provisioned_kind" NOT NULL,
	"contract_key" text NOT NULL,
	"posthog_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posthog_provisioned_objects_site_project_kind_key_unique" UNIQUE("site_id","project_id","kind","contract_key"),
	CONSTRAINT "posthog_provisioned_objects_posthog_id_positive" CHECK ("posthog_provisioned_objects"."posthog_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "posthog_provisioning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"run_by" uuid,
	"kind" "provisioning_kind" NOT NULL,
	"differences" integer NOT NULL,
	"outcome" "provisioning_outcome" NOT NULL,
	"taxonomy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posthog_provisioning_runs_differences_non_negative" CHECK ("posthog_provisioning_runs"."differences" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "uses_heatmaps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "measurement_tier" "measurement_tier" DEFAULT 'essentials' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "tier_confirmed_for" "measurement_tier";--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "tier_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "tier_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "posthog_provisioned_objects" ADD CONSTRAINT "posthog_provisioned_objects_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posthog_provisioning_runs" ADD CONSTRAINT "posthog_provisioning_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posthog_provisioning_runs" ADD CONSTRAINT "posthog_provisioning_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posthog_provisioning_runs_site_created_idx" ON "posthog_provisioning_runs" USING btree ("site_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posthog_provisioning_runs_run_by_idx" ON "posthog_provisioning_runs" USING btree ("run_by");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tier_confirmed_by_users_id_fk" FOREIGN KEY ("tier_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sites_tier_confirmed_by_idx" ON "sites" USING btree ("tier_confirmed_by");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_tier_confirmation_complete" CHECK (("sites"."tier_confirmed_for" is null) = ("sites"."tier_confirmed_at" is null));