import { z } from 'zod';

/**
 * The form of her bubbles (Charles 26/11, ADR 0158 § O): rules applied by code to what she sends, after the guards and
 * before the send, never by a prompt (CLAUDE.md rule 3). Each one is a setting of her persona, or of her agency's base
 * style (ADR 0171), with a default in code; her persona wins.
 */

/** The first letter of a bubble: always a capital, always lower case, or as the voice wrote it. */
export const CAPITALIZATIONS = ['capital', 'lowercase', 'free'] as const;
export const CapitalizationSchema = z.enum(CAPITALIZATIONS);
export type Capitalization = z.infer<typeof CapitalizationSchema>;

/** Before « ? » and « ! »: a space (French typography), none, or as the voice wrote it. */
export const MARK_SPACINGS = ['space', 'none', 'free'] as const;
export const MarkSpacingSchema = z.enum(MARK_SPACINGS);
export type MarkSpacing = z.infer<typeof MarkSpacingSchema>;

/** The bounds of the emoji streak (`emoji_streak_max`): her last N answers with one, the next has none. */
export const EMOJI_STREAK_BOUNDS = [1, 10] as const;

/** Her form settings, each optional: absent, the next layer decides (persona, then base style, then code). */
export const VoiceFormSettingsSchema = z.strictObject({
  capitalization: CapitalizationSchema.optional(),
  /** True: one final « . » is taken off each bubble, never « ... » nor « … ». */
  strip_final_period: z.boolean().optional(),
  mark_spacing: MarkSpacingSchema.optional(),
  /** Her last this-many answers all carried an emoji: the next one carries none (guard `emoji_misuse`). */
  emoji_streak_max: z.int().min(EMOJI_STREAK_BOUNDS[0]).max(EMOJI_STREAK_BOUNDS[1]).optional(),
});
export type VoiceFormSettings = z.infer<typeof VoiceFormSettingsSchema>;
