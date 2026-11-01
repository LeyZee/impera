CREATE TABLE "billing_regime_validations" (
	"regime_id" uuid PRIMARY KEY NOT NULL,
	"validated_on" date NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_regime_validations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_regimes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"countries" text[] NOT NULL,
	"vat_treatment" text NOT NULL,
	"vat_rate_bps" integer,
	"withholding" text NOT NULL,
	"mentions" text[] NOT NULL,
	"documents" text[] NOT NULL,
	"tax_id_required" boolean NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_regimes_name_check" CHECK (char_length("billing_regimes"."name") between 1 and 80),
	CONSTRAINT "billing_regimes_countries_check" CHECK (cardinality("billing_regimes"."countries") >= 1 and array_to_string("billing_regimes"."countries", ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'),
	CONSTRAINT "billing_regimes_vat_treatment_check" CHECK ("billing_regimes"."vat_treatment" in ('reverse_charge', 'exempt', 'charged')),
	CONSTRAINT "billing_regimes_vat_check" CHECK (("billing_regimes"."vat_treatment" = 'exempt') = ("billing_regimes"."vat_rate_bps" is null) and ("billing_regimes"."vat_rate_bps" is null or "billing_regimes"."vat_rate_bps" between 0 and 10000)),
	CONSTRAINT "billing_regimes_withholding_check" CHECK ("billing_regimes"."withholding" in ('treaty_exempt', 'none')),
	CONSTRAINT "billing_regimes_mentions_check" CHECK (cardinality("billing_regimes"."mentions") <= 24 and array_position("billing_regimes"."mentions", null) is null),
	CONSTRAINT "billing_regimes_documents_check" CHECK ("billing_regimes"."documents" <@ array['tax_residence', 'urssaf_vigilance']::text[])
);
--> statement-breakpoint
ALTER TABLE "billing_regimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"agency" jsonb NOT NULL,
	"due_days" smallint NOT NULL,
	"document_reminder_days" smallint NOT NULL,
	"accounts" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_settings_single_check" CHECK ("billing_settings"."id" = 1),
	CONSTRAINT "billing_settings_json_check" CHECK (jsonb_typeof("billing_settings"."agency") = 'object' and jsonb_typeof("billing_settings"."accounts") = 'object'),
	CONSTRAINT "billing_settings_delays_check" CHECK ("billing_settings"."due_days" between 1 and 90 and "billing_settings"."document_reminder_days" between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "billing_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"text_sha256" text NOT NULL,
	"accepted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_acceptances_member_text_unique" UNIQUE("member_id","text_id"),
	CONSTRAINT "contract_acceptances_sha_check" CHECK ("contract_acceptances"."text_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "contract_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract_texts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"sha256" text NOT NULL,
	"contest_delay_days" smallint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_texts_kind_version_unique" UNIQUE("kind","version"),
	CONSTRAINT "contract_texts_kind_check" CHECK ("contract_texts"."kind" in ('service_contract', 'billing_mandate')),
	CONSTRAINT "contract_texts_body_check" CHECK ("contract_texts"."version" >= 1 and char_length("contract_texts"."body") between 1 and 100000 and "contract_texts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "contract_texts_delay_check" CHECK (("contract_texts"."kind" = 'billing_mandate') = ("contract_texts"."contest_delay_days" is not null) and ("contract_texts"."contest_delay_days" is null or "contract_texts"."contest_delay_days" between 1 and 60))
);
--> statement-breakpoint
ALTER TABLE "contract_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_documents_kind_check" CHECK ("contractor_documents"."kind" in ('tax_residence', 'urssaf_vigilance')),
	CONSTRAINT "contractor_documents_dates_check" CHECK ("contractor_documents"."valid_until" is null or "contractor_documents"."valid_until" > "contractor_documents"."issued_on"),
	CONSTRAINT "contractor_documents_file_check" CHECK (char_length("contractor_documents"."storage_key") between 1 and 512 and "contractor_documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "contractor_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_profiles" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"address" text NOT NULL,
	"tax_id" text,
	"email" text NOT NULL,
	"invoice_prefix" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_profiles_prefix_unique" UNIQUE("invoice_prefix"),
	CONSTRAINT "contractor_profiles_texts_check" CHECK (char_length("contractor_profiles"."legal_name") between 1 and 160 and char_length("contractor_profiles"."address") between 1 and 400 and ("contractor_profiles"."tax_id" is null or char_length("contractor_profiles"."tax_id") between 1 and 40) and char_length("contractor_profiles"."email") between 1 and 254),
	CONSTRAINT "contractor_profiles_prefix_check" CHECK ("contractor_profiles"."invoice_prefix" is null or "contractor_profiles"."invoice_prefix" ~ '^[A-Z0-9]{2,8}$'),
	CONSTRAINT "contractor_profiles_verified_check" CHECK (("contractor_profiles"."verified_at" is null) = ("contractor_profiles"."verified_by" is null))
);
--> statement-breakpoint
ALTER TABLE "contractor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_regimes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"regime_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_regimes_member_from_unique" UNIQUE("member_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "contractor_regimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"member_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"last_sequence" integer NOT NULL,
	CONSTRAINT "invoice_counters_pkey" PRIMARY KEY("member_id","year"),
	CONSTRAINT "invoice_counters_values_check" CHECK ("invoice_counters"."year" between 2000 and 9999 and "invoice_counters"."last_sequence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"statement_id" uuid,
	"by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_events_kind_check" CHECK ("invoice_events"."kind" in ('issued', 'accepted', 'contested', 'lapsed', 'credited', 'contest_refused', 'paid')),
	CONSTRAINT "invoice_events_values_check" CHECK (("invoice_events"."kind" = 'paid') = ("invoice_events"."statement_id" is not null) and ("invoice_events"."reason" is null or char_length("invoice_events"."reason") between 1 and 500) and ("invoice_events"."kind" not in ('contested', 'contest_refused') or "invoice_events"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "invoice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"invoice_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "invoice_lines_pkey" PRIMARY KEY("invoice_id","position"),
	CONSTRAINT "invoice_lines_kind_check" CHECK ("invoice_lines"."kind" in ('commission', 'team_share', 'tier_bonus', 'collective_bonus', 'bonus', 'penalty', 'penalty_cap', 'adjustment', 'reduction', 'negative_period')),
	CONSTRAINT "invoice_lines_values_check" CHECK ("invoice_lines"."position" >= 1 and char_length("invoice_lines"."label") between 1 and 200 and ("invoice_lines"."detail" is null or char_length("invoice_lines"."detail") between 1 and 400) and "invoice_lines"."amount_minor" between -5000000 and 5000000)
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_pdfs" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_pdfs_file_check" CHECK (char_length("invoice_pdfs"."storage_key") between 1 and 512 and "invoice_pdfs"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_pdfs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid NOT NULL,
	"statement_id" uuid,
	"credited_invoice_id" uuid,
	"period" date NOT NULL,
	"prefix" text NOT NULL,
	"year" smallint NOT NULL,
	"sequence" integer NOT NULL,
	"number" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_on" date NOT NULL,
	"issued_by" text,
	"due_on" date NOT NULL,
	"contractor" jsonb NOT NULL,
	"agency" jsonb NOT NULL,
	"regime_id" uuid NOT NULL,
	"regime" jsonb NOT NULL,
	"mentions" text[] NOT NULL,
	"excl_vat_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"incl_vat_minor" integer NOT NULL,
	"self_assessed_vat_minor" integer NOT NULL,
	"acceptance_deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_sequence_unique" UNIQUE("member_id","year","sequence"),
	CONSTRAINT "invoices_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "invoices_kind_check" CHECK ("invoices"."kind" in ('invoice', 'credit_note')),
	CONSTRAINT "invoices_document_check" CHECK (("invoices"."kind" = 'invoice' and "invoices"."statement_id" is not null and "invoices"."credited_invoice_id" is null and "invoices"."excl_vat_minor" between 1 and 5000000) or ("invoices"."kind" = 'credit_note' and "invoices"."credited_invoice_id" is not null and "invoices"."excl_vat_minor" between -5000000 and -1)),
	CONSTRAINT "invoices_number_check" CHECK ("invoices"."prefix" ~ '^[A-Z0-9]{2,8}$' and "invoices"."year" between 2000 and 9999 and "invoices"."sequence" >= 1 and "invoices"."number" = "invoices"."prefix" || '-' || "invoices"."year" || '-' || lpad("invoices"."sequence"::text, greatest(4, char_length("invoices"."sequence"::text)), '0') and "invoices"."year" = extract(year from "invoices"."issued_on")),
	CONSTRAINT "invoices_key_check" CHECK (char_length("invoices"."idempotency_key") between 1 and 200),
	CONSTRAINT "invoices_totals_check" CHECK ("invoices"."incl_vat_minor" = "invoices"."excl_vat_minor" + "invoices"."vat_minor" and abs("invoices"."vat_minor") <= abs("invoices"."excl_vat_minor") and abs("invoices"."self_assessed_vat_minor") <= abs("invoices"."excl_vat_minor")),
	CONSTRAINT "invoices_copies_check" CHECK (jsonb_typeof("invoices"."contractor") = 'object' and jsonb_typeof("invoices"."agency") = 'object' and jsonb_typeof("invoices"."regime") = 'object' and cardinality("invoices"."mentions") <= 24 and array_position("invoices"."mentions", null) is null),
	CONSTRAINT "invoices_dates_check" CHECK ("invoices"."due_on" >= "invoices"."issued_on" and "invoices"."acceptance_deadline" > "invoices"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_regime_validations" ADD CONSTRAINT "billing_regime_validations_regime_id_billing_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."billing_regimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_regime_validations" ADD CONSTRAINT "billing_regime_validations_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_regimes" ADD CONSTRAINT "billing_regimes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_text_id_contract_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."contract_texts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_texts" ADD CONSTRAINT "contract_texts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD CONSTRAINT "contractor_documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_regimes" ADD CONSTRAINT "contractor_regimes_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_regimes" ADD CONSTRAINT "contractor_regimes_regime_id_billing_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."billing_regimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_regimes" ADD CONSTRAINT "contractor_regimes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_by_user_id_fk" FOREIGN KEY ("by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_pdfs" ADD CONSTRAINT "invoice_pdfs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_pay_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_periods"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_regime_id_billing_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."billing_regimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credited_invoice_id_invoices_id_fk" FOREIGN KEY ("credited_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_documents_member_idx" ON "contractor_documents" USING btree ("member_id","kind");--> statement-breakpoint
CREATE INDEX "invoice_events_invoice_idx" ON "invoice_events" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_issued_unique" ON "invoice_events" USING btree ("invoice_id") WHERE "invoice_events"."kind" = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_answer_unique" ON "invoice_events" USING btree ("invoice_id") WHERE "invoice_events"."kind" in ('accepted', 'contested', 'lapsed');--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_contest_end_unique" ON "invoice_events" USING btree ("invoice_id") WHERE "invoice_events"."kind" in ('credited', 'contest_refused');--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_paid_unique" ON "invoice_events" USING btree ("invoice_id","statement_id") WHERE "invoice_events"."kind" = 'paid';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_statement_unique" ON "invoices" USING btree ("statement_id") WHERE "invoices"."kind" = 'invoice';--> statement-breakpoint
CREATE INDEX "invoices_member_period_idx" ON "invoices" USING btree ("member_id","period");--> statement-breakpoint
CREATE INDEX "invoices_credited_idx" ON "invoices" USING btree ("credited_invoice_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "billing_regime_validations" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "billing_regime_validations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "billing_regime_validations"."recorded_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "billing_regimes" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "billing_regimes" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "billing_regimes"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "billing_settings" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "billing_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "billing_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "billing_settings" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "billing_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "contract_acceptances" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "contract_acceptances"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_accept" ON "contract_acceptances" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from team_members m where m.id = "contract_acceptances"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "contract_acceptances"."accepted_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "contract_texts" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "contract_texts" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "contract_texts"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "contractor_documents" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "contractor_documents"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "contractor_documents" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((exists (select 1 from team_members m where m.id = "contractor_documents"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) or nullif(current_setting('app.team_scope', true), '') = 'owner') and "contractor_documents"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "contractor_profiles" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "contractor_profiles"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "contractor_profiles" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((exists (select 1 from team_members m where m.id = "contractor_profiles"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) or nullif(current_setting('app.team_scope', true), '') = 'owner') and "contractor_profiles"."updated_by" = nullif(current_setting('app.user_id', true), '') and "contractor_profiles"."verified_at" is null);--> statement-breakpoint
CREATE POLICY "member_update" ON "contractor_profiles" AS PERMISSIVE FOR UPDATE TO public USING (exists (select 1 from team_members m where m.id = "contractor_profiles"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) or nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK ((exists (select 1 from team_members m where m.id = "contractor_profiles"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) or nullif(current_setting('app.team_scope', true), '') = 'owner') and "contractor_profiles"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "contractor_regimes" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "contractor_regimes"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "contractor_regimes" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "contractor_regimes"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "invoice_counters" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "invoice_counters" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = "invoice_counters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_next" ON "invoice_counters" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = "invoice_counters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = "invoice_counters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_read" ON "invoice_events" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from invoices i where i.id = "invoice_events"."invoice_id" and true));--> statement-breakpoint
CREATE POLICY "member_answer" ON "invoice_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("invoice_events"."kind" in ('accepted', 'contested') and "invoice_events"."by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from invoices i where i.id = "invoice_events"."invoice_id" and exists (select 1 from team_members m where m.id = i.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "owner_step" ON "invoice_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("invoice_events"."kind" in ('issued', 'credited', 'contest_refused', 'paid') and "invoice_events"."by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from invoices i where i.id = "invoice_events"."invoice_id" and nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = i.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_read" ON "invoice_lines" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from invoices i where i.id = "invoice_lines"."invoice_id" and true));--> statement-breakpoint
CREATE POLICY "owner_issue" ON "invoice_lines" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from invoices i where i.id = "invoice_lines"."invoice_id" and nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = i.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_read" ON "invoice_pdfs" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from invoices i where i.id = "invoice_pdfs"."invoice_id" and true));--> statement-breakpoint
CREATE POLICY "member_read" ON "invoices" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "invoices"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_issue" ON "invoices" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = "invoices"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "invoices"."issued_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Written by hand (EQ-06 lot 2). Drizzle does not write what follows.
ALTER TABLE "billing_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_regimes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_regime_validations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_regimes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_texts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_acceptances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_pdfs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Refused to every role, the migration's own included: what an invoice was built on stays as it was.
CREATE FUNCTION "refuse_billing_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'this change to % is refused: an invoice keeps its past (EQ-06)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
-- Added only: the regimes and their validations, a contractor's regimes, the documents, the contract texts, the
-- acceptances, and the invoices with their lines, their events and their PDF.
CREATE TRIGGER "billing_regimes_append_only" BEFORE UPDATE OR DELETE ON "billing_regimes"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "billing_regime_validations_append_only" BEFORE UPDATE OR DELETE ON "billing_regime_validations"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "contractor_regimes_append_only" BEFORE UPDATE OR DELETE ON "contractor_regimes"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "contractor_documents_append_only" BEFORE UPDATE OR DELETE ON "contractor_documents"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "contract_texts_append_only" BEFORE UPDATE OR DELETE ON "contract_texts"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "contract_acceptances_append_only" BEFORE UPDATE OR DELETE ON "contract_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoices_append_only" BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoice_lines_append_only" BEFORE UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoice_events_append_only" BEFORE UPDATE OR DELETE ON "invoice_events"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoice_pdfs_append_only" BEFORE UPDATE OR DELETE ON "invoice_pdfs"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
-- Never deleted: the settings, the contractors' files (kept ten years with their invoices) and the counters.
CREATE TRIGGER "billing_settings_not_deleted" BEFORE DELETE ON "billing_settings"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "contractor_profiles_not_deleted" BEFORE DELETE ON "contractor_profiles"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoice_counters_not_deleted" BEFORE DELETE ON "invoice_counters"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
-- A contractor's regime changes from a day after his last one: never backwards, never twice the same day.
CREATE FUNCTION "keep_contractor_regime"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Two assignments of one contractor at once are taken one after the other.
  PERFORM pg_advisory_xact_lock(hashtextextended('contractor_regimes:' || NEW."member_id"::text, 0));
  IF EXISTS (
    SELECT 1 FROM "contractor_regimes" r
    WHERE r."member_id" = NEW."member_id" AND r."effective_from" >= NEW."effective_from"
  ) THEN
    RAISE EXCEPTION 'a regime applies from a day after the contractor''s last one, never backwards (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contractor_regimes_forward" BEFORE INSERT ON "contractor_regimes"
  FOR EACH ROW EXECUTE FUNCTION "keep_contractor_regime"();--> statement-breakpoint
-- A contractor's file: its member never changes; a change of identity clears the owner's check; only the owner, in
-- the application, checks it or sets the prefix, and the prefix is frozen once an invoice carries it. The jobs
-- (`nirvana_admin`, no scope) are not asked who they are.
CREATE FUNCTION "keep_contractor_profile"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope CONSTANT text := nullif(current_setting('app.team_scope', true), '');
  actor CONSTANT text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."verified_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a contractor''s file is checked after it is written (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."invoice_prefix" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."member_id", NEW."created_at") IS DISTINCT FROM (OLD."member_id", OLD."created_at") THEN
    RAISE EXCEPTION 'file % keeps its contractor (EQ-06)', OLD."member_id" USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."invoice_prefix" IS DISTINCT FROM OLD."invoice_prefix" THEN
    IF scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "invoices" i WHERE i."member_id" = OLD."member_id") THEN
      RAISE EXCEPTION 'the prefix of % is frozen by his first invoice (EQ-06)', OLD."member_id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF (NEW."legal_name", NEW."address", NEW."tax_id", NEW."email") IS DISTINCT FROM
     (OLD."legal_name", OLD."address", OLD."tax_id", OLD."email") THEN
    NEW."verified_at" := NULL;
    NEW."verified_by" := NULL;
  ELSIF NEW."verified_at" IS NOT NULL
        AND (NEW."verified_at", NEW."verified_by") IS DISTINCT FROM (OLD."verified_at", OLD."verified_by") THEN
    IF scope IS NOT NULL AND (scope <> 'owner' OR NEW."verified_by" IS DISTINCT FROM actor) THEN
      RAISE EXCEPTION 'only the owner checks a contractor''s file, in his own name (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW."verified_at" IS NULL AND OLD."verified_at" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
    RAISE EXCEPTION 'only the owner withdraws his check (EQ-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contractor_profiles_kept" BEFORE INSERT OR UPDATE ON "contractor_profiles"
  FOR EACH ROW EXECUTE FUNCTION "keep_contractor_profile"();--> statement-breakpoint
-- A contract text is the next version of its kind, and its SHA-256 is that of its exact text, in UTF-8.
CREATE FUNCTION "keep_contract_text"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sha256" IS DISTINCT FROM encode(sha256(convert_to(NEW."body", 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'a contract text carries the SHA-256 of its exact text (EQ-06)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."version" <> coalesce(
    (SELECT max(t."version") FROM "contract_texts" t WHERE t."kind" = NEW."kind"), 0
  ) + 1 THEN
    RAISE EXCEPTION 'a % text takes the next version of its kind (EQ-06)', NEW."kind"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contract_texts_next" BEFORE INSERT ON "contract_texts"
  FOR EACH ROW EXECUTE FUNCTION "keep_contract_text"();--> statement-breakpoint
-- An acceptance copies the SHA-256 of the text it accepts: the proof of what was read.
CREATE FUNCTION "keep_contract_acceptance"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "contract_texts" t WHERE t."id" = NEW."text_id" AND t."sha256" = NEW."text_sha256"
  ) THEN
    RAISE EXCEPTION 'an acceptance copies the SHA-256 of the text it accepts (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contract_acceptances_proof" BEFORE INSERT ON "contract_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "keep_contract_acceptance"();--> statement-breakpoint
-- A counter starts at 1 and moves by one: the number a transaction takes is the one it wrote, locked FOR UPDATE.
CREATE FUNCTION "keep_invoice_counter"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."last_sequence" <> 1
     OR TG_OP = 'UPDATE' AND ((NEW."member_id", NEW."year") IS DISTINCT FROM (OLD."member_id", OLD."year")
                              OR NEW."last_sequence" <> OLD."last_sequence" + 1) THEN
    RAISE EXCEPTION 'an invoice counter starts at 1 and moves by one (EQ-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoice_counters_by_one" BEFORE INSERT OR UPDATE ON "invoice_counters"
  FOR EACH ROW EXECUTE FUNCTION "keep_invoice_counter"();--> statement-breakpoint
-- An invoice is numbered by its contractor's prefix and counter (the number the counter holds now: without hole nor
-- repeat), for a validated statement of its contractor and period, under his regime of its day of issue, which the
-- accountant validated by that day, and once he has accepted a billing mandate (ADR 0023: without one, the statement
-- is validated and no invoice is issued; any version of the mandate will do here, an older one is a warning of the
-- application). A credit note cites an invoice of the same contractor and keeps its period (the service it corrects) and
-- its regime (ADR 0036); its statement, when it has one, is the later one whose validation owes it; it never takes
-- more than what is left of the invoice.
CREATE FUNCTION "keep_invoice"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cited "invoices"%ROWTYPE;
BEGIN
  -- The instant of the transaction that issues it: its lines and its event `issued` are written in that one.
  NEW."created_at" := now();
  IF NOT EXISTS (
    SELECT 1 FROM "contractor_profiles" p WHERE p."member_id" = NEW."member_id" AND p."invoice_prefix" = NEW."prefix"
  ) OR NOT EXISTS (
    SELECT 1 FROM "invoice_counters" c
    WHERE c."member_id" = NEW."member_id" AND c."year" = NEW."year" AND c."last_sequence" = NEW."sequence"
  ) THEN
    RAISE EXCEPTION 'an invoice takes its contractor''s prefix and the number his counter holds (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."statement_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."statement_id" AND s."member_id" = NEW."member_id" AND s."status" IN ('validated', 'paid')
      AND CASE NEW."kind" WHEN 'invoice' THEN s."period" = NEW."period" ELSE s."period" > NEW."period" END
  ) THEN
    RAISE EXCEPTION 'an invoice bills a validated statement of its contractor and period; a credit note is owed by a later one (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."kind" = 'invoice' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "billing_regime_validations" v
      WHERE v."regime_id" = NEW."regime_id" AND v."validated_on" <= NEW."issued_on"
    ) THEN
      RAISE EXCEPTION 'an invoice is issued under a regime the accountant validated by its day of issue (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- None assigned by that day: no regime, no invoice.
    IF NEW."regime_id" IS DISTINCT FROM (
      SELECT r."regime_id" FROM "contractor_regimes" r
      WHERE r."member_id" = NEW."member_id" AND r."effective_from" <= NEW."issued_on"
      ORDER BY r."effective_from" DESC
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'an invoice is issued under its contractor''s regime of its day of issue (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "contract_acceptances" a
      JOIN "contract_texts" t ON t."id" = a."text_id"
      WHERE a."member_id" = NEW."member_id" AND t."kind" = 'billing_mandate'
    ) THEN
      RAISE EXCEPTION 'an invoice is issued once its contractor has accepted a billing mandate (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Two credit notes on one invoice at once are taken one after the other, each counting the one before.
  PERFORM pg_advisory_xact_lock(hashtextextended('invoices:' || NEW."credited_invoice_id"::text, 0));
  SELECT * INTO cited FROM "invoices" i WHERE i."id" = NEW."credited_invoice_id";
  IF NOT FOUND OR cited."kind" <> 'invoice' OR cited."member_id" <> NEW."member_id"
     OR cited."period" <> NEW."period" OR cited."regime_id" <> NEW."regime_id" OR cited."regime" <> NEW."regime" THEN
    RAISE EXCEPTION 'a credit note cites an invoice of its contractor and keeps its period and regime (ADR 0036)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF cited."excl_vat_minor" + NEW."excl_vat_minor" + coalesce((
    SELECT sum(n."excl_vat_minor") FROM "invoices" n
    WHERE n."credited_invoice_id" = cited."id" AND n."kind" = 'credit_note'
  ), 0) < 0 THEN
    RAISE EXCEPTION 'a credit note never takes more than what is left of invoice % (EQ-06)', cited."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoices_issued" BEFORE INSERT ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "keep_invoice"();--> statement-breakpoint
-- At the commit of the transaction that issues it, an invoice has its lines, they add up to its total, and its event
-- `issued` is written: without it, it would have no state to stand in.
CREATE FUNCTION "check_invoice_at_commit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "invoice_lines" l WHERE l."invoice_id" = NEW."id")
     OR (SELECT sum(l."amount_minor") FROM "invoice_lines" l WHERE l."invoice_id" = NEW."id") <> NEW."excl_vat_minor" THEN
    RAISE EXCEPTION 'the lines of invoice % add up to its total (EQ-06)', NEW."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "invoice_events" e WHERE e."invoice_id" = NEW."id" AND e."kind" = 'issued') THEN
    RAISE EXCEPTION 'invoice % is written with its event issued (EQ-06)', NEW."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "invoices_whole_at_commit" AFTER INSERT ON "invoices"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_invoice_at_commit"();--> statement-breakpoint
-- A line is written in the transaction that issues its invoice (`now()` is the transaction's instant), never after.
CREATE FUNCTION "keep_invoice_line"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."id" = NEW."invoice_id" AND i."created_at" = now()) THEN
    RAISE EXCEPTION 'a line is written with its invoice, never after (EQ-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoice_lines_with_invoice" BEFORE INSERT ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "keep_invoice_line"();--> statement-breakpoint
-- An invoice's acceptance is its events, along the steps of `invoice-acceptance.ts`: issued in its own transaction;
-- then accepted or contested before the mandate's delay, or accepted tacitly (`lapsed`) once it is over; a contest
-- ends credited, once a credit note written after it cites the invoice, or refused. A credit note follows the same
-- steps (ADR 0036), except that no credit note cites it: its contest ends refused, never credited. The partial unique
-- indexes keep one issue, one answer and one end of a contest. A payment is an invoice's, never a credit note's (the
-- reconciliation imputes those, ADR 0036), and names a paid statement of the same contractor, of the invoice's period
-- or of a later one that pays what was carried over.
CREATE FUNCTION "keep_invoice_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice "invoices"%ROWTYPE;
  contested_at timestamptz;
BEGIN
  SELECT * INTO invoice FROM "invoices" i WHERE i."id" = NEW."invoice_id";
  -- An invoice its author cannot read is the policy's to refuse, a missing one the foreign key's.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT e."created_at" INTO contested_at FROM "invoice_events" e
  WHERE e."invoice_id" = NEW."invoice_id" AND e."kind" = 'contested';
  -- In parentheses: PL/pgSQL would end the condition at the first THEN of the CASE.
  IF (CASE NEW."kind"
    WHEN 'issued' THEN invoice."created_at" = now()
    WHEN 'accepted' THEN now() < invoice."acceptance_deadline"
    WHEN 'contested' THEN now() < invoice."acceptance_deadline"
    WHEN 'lapsed' THEN now() >= invoice."acceptance_deadline"
    WHEN 'credited' THEN invoice."kind" = 'invoice' AND contested_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM "invoices" n
      WHERE n."credited_invoice_id" = NEW."invoice_id" AND n."kind" = 'credit_note' AND n."created_at" >= contested_at)
    WHEN 'contest_refused' THEN contested_at IS NOT NULL
    WHEN 'paid' THEN invoice."kind" = 'invoice' AND EXISTS (
      SELECT 1 FROM "commission_statements" s
      WHERE s."id" = NEW."statement_id" AND s."member_id" = invoice."member_id" AND s."status" = 'paid'
        AND s."period" >= invoice."period")
  END) IS NOT TRUE THEN
    RAISE EXCEPTION 'event % does not follow where invoice % stands (EQ-06)', NEW."kind", invoice."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoice_events_in_order" BEFORE INSERT ON "invoice_events"
  FOR EACH ROW EXECUTE FUNCTION "keep_invoice_event"();--> statement-breakpoint
-- The period an adjustment corrects is that of the statement it cites (ADR 0036: its credit note goes on that
-- period's invoice): a statement of the same member, validated or paid, of an earlier period.
CREATE FUNCTION "keep_corrected_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."corrects_statement_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."corrects_statement_id" AND s."member_id" = NEW."member_id"
      AND s."status" IN ('validated', 'paid') AND s."period" < NEW."period"
  ) THEN
    RAISE EXCEPTION 'an adjustment corrects a validated statement of its member, of an earlier period (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_adjustments_corrected_statement" BEFORE INSERT ON "pay_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "keep_corrected_statement"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
-- The application adds rows under the policies and changes only the settings, a contractor's file and a counter; the
-- jobs (`nirvana_admin`) write a PDF and a tacit acceptance.
REVOKE ALL ON "billing_settings", "billing_regimes", "billing_regime_validations", "contractor_regimes",
  "contractor_profiles", "contractor_documents", "contract_texts", "contract_acceptances", "invoice_counters",
  "invoices", "invoice_lines", "invoice_events", "invoice_pdfs" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "billing_settings", "billing_regimes", "billing_regime_validations", "contractor_regimes",
  "contractor_profiles", "contractor_documents", "contract_texts", "contract_acceptances", "invoice_counters",
  "invoices", "invoice_lines", "invoice_events" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "invoice_pdfs" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("agency", "due_days", "document_reminder_days", "accounts", "updated_by", "updated_at")
  ON "billing_settings" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("legal_name", "address", "tax_id", "email", "invoice_prefix", "verified_at", "verified_by",
  "updated_by", "updated_at") ON "contractor_profiles" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("last_sequence") ON "invoice_counters" TO nirvana_app;
