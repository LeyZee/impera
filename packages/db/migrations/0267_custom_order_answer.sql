-- ADR 0159 § A.3: her answer on a custom order, entered by the owner: her price, the deposit it asks, who and when. Additive.
ALTER TABLE "custom_orders" ADD COLUMN "price_minor" integer;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD COLUMN "deposit_minor" integer;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_price_check" CHECK ("custom_orders"."price_minor" is null or "custom_orders"."price_minor" >= 100);--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_deposit_check" CHECK ("custom_orders"."deposit_minor" is null or ("custom_orders"."price_minor" is not null and "custom_orders"."deposit_minor" between 0 and "custom_orders"."price_minor"));
