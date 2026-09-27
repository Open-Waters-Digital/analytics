CREATE TYPE "public"."pe_form_factor" AS ENUM('phone', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."pe_lab_run_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pe_scope" AS ENUM('origin', 'page');--> statement-breakpoint
CREATE TYPE "public"."pe_source" AS ENUM('field', 'field_history', 'lab');--> statement-breakpoint
CREATE TYPE "public"."pe_status" AS ENUM('ok', 'not_enough_data', 'failed');--> statement-breakpoint
ALTER TYPE "public"."snapshot_source" ADD VALUE 'page_experience';--> statement-breakpoint
CREATE TABLE "pe_lab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"run_by" uuid,
	"status" "pe_lab_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"pages_done" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_page_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" "pe_source" NOT NULL,
	"scope" "pe_scope" NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"form_factor" "pe_form_factor" NOT NULL,
	"status" "pe_status" NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"fcp_ms" integer,
	"ttfb_ms" integer,
	"tbt_ms" integer,
	"speed_index_ms" integer,
	"cls" numeric(6, 4),
	"lab_score" smallint,
	"distribution" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_page_experience_site_day_source_scope_path_form_unique" UNIQUE("site_id","day","source","scope","path","form_factor"),
	CONSTRAINT "site_page_experience_lab_score_range" CHECK ("site_page_experience"."lab_score" is null or ("site_page_experience"."lab_score" >= 0 and "site_page_experience"."lab_score" <= 100)),
	CONSTRAINT "site_page_experience_reason_when_failed" CHECK ("site_page_experience"."status" <> 'failed' or "site_page_experience"."reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "site_performance_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"lcp_ms" integer,
	"inp_ms" integer,
	"cls" numeric(5, 3),
	"lab_score" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_performance_budgets_siteId_unique" UNIQUE("site_id"),
	CONSTRAINT "site_performance_budgets_non_negative" CHECK (coalesce("site_performance_budgets"."lcp_ms", 0) >= 0 and coalesce("site_performance_budgets"."inp_ms", 0) >= 0 and coalesce("site_performance_budgets"."cls", 0) >= 0),
	CONSTRAINT "site_performance_budgets_lab_score_range" CHECK ("site_performance_budgets"."lab_score" is null or ("site_performance_budgets"."lab_score" >= 0 and "site_performance_budgets"."lab_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "site_tracked_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_tracked_pages_site_path_unique" UNIQUE("site_id","path"),
	CONSTRAINT "site_tracked_pages_path_shape" CHECK ("site_tracked_pages"."path" ~ '^/[^?#]*$'),
	CONSTRAINT "site_tracked_pages_path_length" CHECK (length("site_tracked_pages"."path") <= 200)
);
--> statement-breakpoint
ALTER TABLE "pe_lab_runs" ADD CONSTRAINT "pe_lab_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pe_lab_runs" ADD CONSTRAINT "pe_lab_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_experience" ADD CONSTRAINT "site_page_experience_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_performance_budgets" ADD CONSTRAINT "site_performance_budgets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_tracked_pages" ADD CONSTRAINT "site_tracked_pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pe_lab_runs_site_started_idx" ON "pe_lab_runs" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pe_lab_runs_run_by_idx" ON "pe_lab_runs" USING btree ("run_by");--> statement-breakpoint
CREATE INDEX "site_page_experience_site_day_idx" ON "site_page_experience" USING btree ("site_id","day" DESC NULLS LAST);