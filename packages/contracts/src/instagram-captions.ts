import { z } from 'zod';

/*
 * The captions proposed for a Reel she dropped (INS-05 lot b, ADR 0162 § 9): three of them, each in its own style, on a
 * decision card she answers with one gesture. « D'autres idées » asks for three more, with her hints.
 */

/** How a caption is written. Each proposal of a card has its own; her choices, style by style, feed the Monday review. */
export const CAPTION_STYLES = ['question', 'teasing', 'funny', 'story', 'short'] as const;
export const CaptionStyleSchema = z.enum(CAPTION_STYLES);
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

/** What she reads beside a caption. */
export const CAPTION_STYLE_LABELS: Readonly<Record<CaptionStyle, string>> = {
  question: 'Question',
  teasing: 'Taquine',
  funny: 'Drôle',
  story: 'Raconte',
  short: 'Courte',
};

/** How many captions one card proposes: a choice, never a list. */
export const CAPTION_PROPOSALS = 3;
/** Instagram's own bound on a caption. */
export const CAPTION_MAX = 2200;

/** What she may touch to ask for other ideas (captures « cartes-de-decision-2 », 21/11). */
export const CAPTION_HINTS = ['shorter', 'funnier', 'flirtier', 'with_question', 'about_place'] as const;
export const CaptionHintSchema = z.enum(CAPTION_HINTS);
export type CaptionHint = z.infer<typeof CaptionHintSchema>;

export const CAPTION_HINT_LABELS: Readonly<Record<CaptionHint, string>> = {
  shorter: 'Plus courte',
  funnier: 'Plus drôle',
  flirtier: 'Plus coquine',
  with_question: 'Avec une question',
  about_place: 'Parle du lieu',
};

/** Her own words beside the hints: one line, read as a data by the model, never as an instruction. */
export const CAPTION_NOTE_MAX = 140;

/** `POST /v1/creator-space/decisions/:id/other-ideas`: at least a hint or a few words. */
export const OtherCaptionIdeasBodySchema = z
  .strictObject({
    hints: z.array(CaptionHintSchema).max(CAPTION_HINTS.length),
    note: z.string().trim().max(CAPTION_NOTE_MAX),
  })
  .refine((body) => new Set(body.hints).size === body.hints.length, { message: 'each hint once' })
  .refine((body) => body.hints.length > 0 || body.note !== '', { message: 'a hint or a few words' });
export type OtherCaptionIdeasBody = z.infer<typeof OtherCaptionIdeasBodySchema>;

/** What the model gives back for one card: captions with their style, read again by the code (guard, one per style). */
export const CaptionProposalsSchema = z.strictObject({
  captions: z
    .array(z.strictObject({ style: CaptionStyleSchema, text: z.string().trim().min(1).max(CAPTION_MAX) }))
    .min(1)
    .max(CAPTION_STYLES.length),
});
export type CaptionProposals = z.infer<typeof CaptionProposalsSchema>;
