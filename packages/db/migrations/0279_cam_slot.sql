-- ADR 0159 § 5: a call's or a video call's slot in her dispos cam, booked by the code with his full payment. Additive.
ALTER TABLE "custom_orders" ADD COLUMN "cam_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD COLUMN "cam_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_cam_check" CHECK (("custom_orders"."cam_starts_at" is null and "custom_orders"."cam_ends_at" is null) or "custom_orders"."cam_ends_at" > "custom_orders"."cam_starts_at");