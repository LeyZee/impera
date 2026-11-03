-- The reports of the reliability check (ADR 0050 § 8, CRM-02), kept so the switch of an account to the platform's net
-- (CRM-03) can rest on the latest clean one. A report is never rewritten nor removed; the export it read is never kept.
CREATE TABLE "sales_feed_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"verdict" text NOT NULL,
	"clean" boolean NOT NULL,
	"report" jsonb NOT NULL,
	"checked_by" text,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_checks_platform_check" CHECK ("sales_feed_checks"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "sales_feed_checks_verdict_check" CHECK ("sales_feed_checks"."verdict" in ('match', 'mismatch', 'incomplete')),
	CONSTRAINT "sales_feed_checks_days_check" CHECK ("sales_feed_checks"."from_day" <= "sales_feed_checks"."to_day"),
	CONSTRAINT "sales_feed_checks_clean_check" CHECK (not "sales_feed_checks"."clean" or "sales_feed_checks"."verdict" = 'match')
);
--> statement-breakpoint
CREATE INDEX "sales_feed_checks_latest_idx" ON "sales_feed_checks" USING btree ("platform","generated_at");--> statement-breakpoint
CREATE TRIGGER "sales_feed_checks_append_only" BEFORE UPDATE OR DELETE ON "sales_feed_checks"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- The application role reads the reports and adds one per check, never more.
REVOKE ALL ON "sales_feed_checks" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "sales_feed_checks" TO nirvana_app;
