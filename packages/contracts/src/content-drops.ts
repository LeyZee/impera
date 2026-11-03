import { z } from 'zod';

/**
 * The closed list of drop categories (ADR 0055 § 1, glossary « Catégorie de dépôt »): the creator chooses it, the code
 * never guesses or changes it, and a medium goes only to its category's output.
 */
export const DROP_CATEGORIES = [
  'feed_shoot',
  'feed_video',
  'script',
  'mass_dm',
  'reveal_story',
  'instagram_story',
  'instagram_reel',
  'instagram_post',
  'telegram_post',
] as const;
export const DropCategorySchema = z.enum(DROP_CATEGORIES);
export type DropCategory = z.infer<typeof DropCategorySchema>;

/**
 * The categories that leave for a public output (ADR 0055 § 1: feed, stories, Instagram, Telegram), where « jamais de
 * nu » holds. A script and a relance go to one fan, behind a payment or in a conversation.
 */
export const PUBLIC_DROP_CATEGORIES: ReadonlySet<DropCategory> = new Set([
  'feed_shoot',
  'feed_video',
  'reveal_story',
  'instagram_story',
  'instagram_reel',
  'instagram_post',
  'telegram_post',
]);

/** The categories that leave for Instagram, where the Instagram guard holds (ADR 0057 § 6). */
export const INSTAGRAM_DROP_CATEGORIES: ReadonlySet<DropCategory> = new Set([
  'instagram_story',
  'instagram_reel',
  'instagram_post',
]);
