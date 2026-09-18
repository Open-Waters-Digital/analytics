CREATE TYPE "public"."snapshot_outcome" AS ENUM('ok', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "site_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"value" integer NOT NULL,
	"value_minor" integer,
	"currency" "currency",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_daily_metrics_site_day_metric_dimension_unique" UNIQUE("site_id","day","metric","dimension"),
	CONSTRAINT "site_daily_metrics_value_non_negative" CHECK ("site_daily_metrics"."value" >= 0),
	CONSTRAINT "site_daily_metrics_currency_required" CHECK ("site_daily_metrics"."value_minor" is null or "site_daily_metrics"."currency" is not null),
	CONSTRAINT "site_daily_metrics_dimension_length" CHECK (length("site_daily_metrics"."dimension") <= 200)
);
--> statement-breakpoint
CREATE TABLE "site_snapshot_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"outcome" "snapshot_outcome" NOT NULL,
	"reason" text,
	"days_written" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_snapshot_results_run_site_unique" UNIQUE("run_id","site_id"),
	CONSTRAINT "site_snapshot_results_reason_required" CHECK ("site_snapshot_results"."outcome" = 'ok' or "site_snapshot_results"."reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"sites_ok" integer DEFAULT 0 NOT NULL,
	"sites_failed" integer DEFAULT 0 NOT NULL,
	"sites_skipped" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_daily_metrics" ADD CONSTRAINT "site_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_snapshot_results" ADD CONSTRAINT "site_snapshot_results_run_id_snapshot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_snapshot_results" ADD CONSTRAINT "site_snapshot_results_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_daily_metrics_site_day_idx" ON "site_daily_metrics" USING btree ("site_id","day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "site_snapshot_results_run_id_idx" ON "site_snapshot_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "site_snapshot_results_site_created_idx" ON "site_snapshot_results" USING btree ("site_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "snapshot_runs_started_at_idx" ON "snapshot_runs" USING btree ("started_at" DESC NULLS LAST);