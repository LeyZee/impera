-- data-model.md: the journals are append-only. Their trigger (`refuse_change`, ADR 0007) already refuses every UPDATE
-- and DELETE, whoever asks; the rights of the application role now say the same thing, as they do for every other
-- append-only table and for the service role (ADR 0087 § 3). No code changes or removes a line of these tables.
-- `platform_sales` is here for the bases made by init.sql, whose default privileges had handed it UPDATE and DELETE.
REVOKE UPDATE, DELETE, TRUNCATE ON
	"audit_log", "conversation_events", "domain_events", "platform_sales"
	FROM nirvana_app;
