import { z } from 'zod';

/**
 * What the brain reads in his last messages (`Brief.intent`, docs/architecture/ai-engine.md): one closed list, shared
 * by the model's output schema (`packages/llm`) and the screens that show it (the playground). The policy decides in
 * code from it; a new intent enters here first.
 */
export const BRIEF_INTENTS = [
  'small_talk',
  'kyc_answer',
  'flirt',
  'sexting',
  'media_reaction',
  'asks_for_media',
  'price_objection',
  'asks_if_bot',
  'asks_to_meet',
  'asks_personal_contact',
  'asks_for_service',
  'distress',
  'complaint',
  'off_topic_request',
  'other',
] as const;
export const BriefIntentSchema = z.enum(BRIEF_INTENTS);
export type BriefIntent = z.infer<typeof BriefIntentSchema>;
