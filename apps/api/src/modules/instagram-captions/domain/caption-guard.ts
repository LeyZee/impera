import { CAPTION_MAX, instagramFaults, nudityIn } from '@impera/contracts';

/**
 * The guard of a caption (ADR 0057 § 6, ADR 0055 § 1), in the code and never left to the prompt: Instagram never hears
 * of an adult platform, a link, a price or « lien en bio », carries five keywords at most, and a public output never
 * says nudity. A caption that fails is not proposed to her.
 */
export type CaptionFault = 'length' | 'adult_platform' | 'link' | 'price' | 'too_many_keywords' | 'nudity';

/** What refuses `text` as a caption, empty when it passes. */
export function captionFaults(text: string): CaptionFault[] {
  const caption = text.trim();
  const faults: CaptionFault[] = [];
  if (caption === '' || caption.length > CAPTION_MAX) faults.push('length');
  faults.push(...instagramFaults(caption));
  if (nudityIn(caption) !== null) faults.push('nudity');
  return faults;
}
