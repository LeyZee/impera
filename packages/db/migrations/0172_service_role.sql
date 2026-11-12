DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'impera_service') THEN
    CREATE ROLE impera_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO impera_service;--> statement-breakpoint
GRANT USAGE ON SCHEMA drizzle TO impera_service;--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO impera_service;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO impera_service;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO impera_service;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, text, timestamptz, integer, text, text) TO impera_service;--> statement-breakpoint
GRANT DELETE ON
	"fan_facts", "script_structure_queue", "session", "two_factor", "verification"
	TO impera_service;--> statement-breakpoint
GRANT INSERT ON
	"audit_log", "commission_statement_lines", "content_requests", "contractor_document_purges",
	"domain_events", "exchange_rates", "invoice_events", "invoice_lines", "invoice_pdf_copies", "invoice_pdfs",
	"invoices", "llm_calls", "media_descriptions", "pay_periods", "push_server_keys", "script_drop_summaries",
	"shifts"
	TO impera_service;--> statement-breakpoint
GRANT UPDATE ON
	"content_drop_files", "content_drops", "content_ideas", "creators", "script_structure_versions",
	"script_structures", "shift_reports", "shift_swap_requests", "shift_templates", "team_members",
	"telegram_state"
	TO impera_service;--> statement-breakpoint
GRANT INSERT, DELETE ON
	"sales_feed_deliveries", "telegram_link_codes", "telegram_routes", "telegram_settings"
	TO impera_service;--> statement-breakpoint
GRANT INSERT, UPDATE ON
	"account", "calendar_links", "commission_statements", "extension_links", "invitation_links",
	"invoice_counters", "media_assets", "password_reset_links", "platform_daily_stats", "push_subscriptions",
	"sales_feed_chatter_reviews", "sales_feed_chatters", "sales_feed_cursors", "sales_feed_stats_calls",
	"script_cadences", "telegram_bots", "telegram_channels", "telegram_deliveries", "user"
	TO impera_service;--> statement-breakpoint
GRANT UPDATE, DELETE ON
	"passkey"
	TO impera_service;--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON
	"pay_period_blocks", "provider_credentials", "sales_feed_credentials", "sales_feed_webhooks",
	"telegram_chats", "telegram_private_links", "worker_heartbeats"
	TO impera_service;
