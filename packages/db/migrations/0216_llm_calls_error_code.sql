-- 16/11, relevé du PC: why a model's answer did not fit its schema (packages/llm, `invalidOutputCode`): field paths
-- and Zod codes, `truncated` or `json`, never content. NULL otherwise. Additive, no data touched.
ALTER TABLE "llm_calls" ADD COLUMN "error_code" text;
