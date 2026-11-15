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
  | 'creator_alert'
  /** What the code knows of a drop she made (ADR 0083): a step's name and instruction are written by the agency. */
  | 'drop_context'
  /** A sent script's steps (ADR 0083 § 6): the agency's cards and the media's descriptions, read as data. */
  | 'script_steps'
  /**
   * Her channel's posts (ADR 0080 § 5): the examples the agency chose, where her link leads, an advice of the agency.
   * Written by the agency, still read as data, never as an order.
   */
  | 'channel_examples'
  | 'link_destination'
  | 'agency_advice'
  /** A reply of her bank to a price objection (ADR 0090 § 8): the agency's words, said in hers, never an order. */
  | 'objection_reply'
  /** What a script of her catalogue is about (ADR 0098 § 6): the agency's words, a criterion for the brain's pick. */
  | 'script_description'
  /** The script step code decided to send now (ADR 0098 § 5): its kind, the agency's instruction, the price, the media. */
  | 'script_step';

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
