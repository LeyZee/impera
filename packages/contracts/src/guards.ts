import { z } from 'zod';

/**
 * The codes of the agent's guards on what she writes (`checkVoiceOutput`, docs/architecture/ai-engine.md « Les
 * gardes »): a closed list, so that every screen has a label for each one it shows. A code never leaves the list once
 * written, since the details of a refused approval and the calibration read them back: one no longer emitted stays,
 * marked obsolete.
 */
export const GUARD_CODES = [
  'ai_disclosure',
  'love_declaration',
  'meeting_promise',
  'contact_info',
  'assistant_output',
  'ai_tic',
  'forbidden_term',
  'too_many_bubbles',
  'bubble_too_long',
  'asks_for_nudes',
  'contempt',
  'payment_lie',
  'discount',
  'explicit_before_age',
  'guilt_trip',
  'pet_name',
  // P3-13.
  'stage_direction',
  'media_not_sent',
  'platform_meeting_word',
  'fake_emergency',
  'repetition',
  'closed_question_streak',
] as const;
export const GuardCodeSchema = z.enum(GUARD_CODES);
export type GuardCode = z.infer<typeof GuardCodeSchema>;
