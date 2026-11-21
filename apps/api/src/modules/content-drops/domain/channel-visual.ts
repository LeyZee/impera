import { DropMediaDescriptionSchema, nudityIn } from '@impera/contracts';

/**
 * Her Telegram channel's visuals (ADR 0162 § 5.2): a medium goes out on it only when its validated description says it
 * shows no nudity. A Mass DM's medium never went through « jamais de nu » (it is not a public category), so every
 * candidate is read here, whatever its drop. What the voice reads of it is its factual sentence.
 */
export function publicDescriptionOf(content: unknown): string | null {
  const parsed = DropMediaDescriptionSchema.safeParse(content);
  if (!parsed.success) return null;
  const description = parsed.data;
  if (description.intensity !== 'soft' && description.intensity !== 'suggestive') return null;
  if (description.anatomyVisible.includes('genitals')) return null;
  // In doubt, no visual: a public send is never taken back (Sécurité, 21/11/2026).
  if (description.flags.length > 0 || description.notVisible || description.confidenceLow) return null;
  if (description.outfit?.style === 'nothing') return null;
  if (nudityIn(description.factualDescription) !== null || nudityIn(description.detailed) !== null)
    return null;
  return description.factualDescription;
}

/** Telegram takes a file of 50 MB at most from a bot; a heavier one is not sent. */
export const CHANNEL_FILE_MAX_BYTES = 50 * 1024 * 1024;
