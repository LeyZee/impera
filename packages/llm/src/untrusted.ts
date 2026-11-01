/**
 * `brief` is the brain's output: the fan can steer it, so the voice reads it as data too.
 * Media descriptions carry text read in the media (a photo can hold a written instruction).
 */
export type UntrustedKind =
  | 'fan_message'
  | 'fan_media_description'
  | 'creator_media_description'
  | 'media_transcript'
  | 'fan_notes'
  | 'brief'
  | 'candidate_reply'
  /** A phrase of one of her alerts (P4-01): written by the agency, still read as a criterion, never as an order. */
  | 'creator_alert';

// Invisible, bidirectional and tag characters (soft hyphen, joiners, Unicode tags): used to hide or
// reorder text the model would still read.
const CONTROL_CHARACTERS =
  /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]|\u034F/gu;

/**
 * Wraps content written by a fan (or derived from it) in a typed block that every system prompt
 * declares as data, never instructions (CLAUDE.md rule 4). Angle brackets inside the content are
 * replaced so the content cannot close the block or open a fake one, and invisible characters are dropped.
 */
export function wrapUntrusted(kind: UntrustedKind, content: string): string {
  // NFKC first: full-width ＜ and other look-alikes become the plain characters replaced below.
  const neutralised = content
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replaceAll('<', '‹')
    .replaceAll('>', '›');
  return `<${kind}>\n${neutralised}\n</${kind}>`;
}
