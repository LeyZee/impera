-- ADR 0070 (CR-06): a video she drops weighs up to 10 GiB and comes in any common container (MOV, MP4, M4V, 3GP, MKV,
-- WebM, AVI). Both checks only widen: no existing row falls outside them.
ALTER TABLE "content_drop_files" DROP CONSTRAINT "content_drop_files_mime_check";--> statement-breakpoint
ALTER TABLE "content_drop_files" DROP CONSTRAINT "content_drop_files_bytes_check";--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_mime_check" CHECK ("content_drop_files"."mime" in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/3gpp', 'video/x-matroska', 'video/webm', 'video/x-msvideo', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a'));--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_bytes_check" CHECK ("content_drop_files"."bytes" > 0 and "content_drop_files"."bytes" <= case when "content_drop_files"."kind" = 'video' then 10737418240 else 31457280 end);
