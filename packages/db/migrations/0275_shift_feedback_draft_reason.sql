ALTER TABLE "shift_feedbacks" ADD COLUMN "draft_reason" text;--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ADD CONSTRAINT "shift_feedbacks_draft_reason_check" CHECK ("shift_feedbacks"."draft_reason" in ('too_long', 'not_her_voice', 'sale_too_early', 'forgot_fan', 'other'));
