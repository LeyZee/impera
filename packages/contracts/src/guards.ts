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
  // Obsolete since 02/11: Reveal flags no word (`OBSOLETE_GUARD_CODES`).
  'platform_meeting_word',
  'fake_emergency',
  'repetition',
  'closed_question_streak',
  // Recette 05/11, MOT-04 (Charles, « go recos »).
  'off_platform_payment',
  'price_outside_offer',
  // ADR 0080 § 5.3, relecture Agent de #654: a post of her Telegram channel only.
  'false_scarcity',
  // ADR 0088 § 3: a care answer (a fan in distress) that sells, meets or goes sexual.
  'care_breach',
] as const;
export const GuardCodeSchema = z.enum(GUARD_CODES);
export type GuardCode = z.infer<typeof GuardCodeSchema>;

/**
 * @public The codes no guard emits any more, kept in `GUARD_CODES` for the refusals and calibration already stored.
 * `platform_meeting_word` blocked a meeting word even in a refusal; Reveal flags none (Charles, 02/11), and a meeting
 * proposed with those words is `meeting_promise`.
 */
export const OBSOLETE_GUARD_CODES: readonly GuardCode[] = ['platform_meeting_word'];

/** Codes the agent's guards never emit: the checks of a post of her Telegram channel's own (ADR 0080 § 5.3). */
export const CHANNEL_ONLY_GUARD_CODES: readonly GuardCode[] = ['false_scarcity'];
