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
  /** What of his card a script meets (Charles 26/11): his own words, computed by code, a criterion for the brain. */
  | 'script_matches'
  /** What the step he has in front of him shows (Charles 26/11): its media sheet, read as data. */
  | 'current_step'
  /** A fantasy of his from his card (Charles 26/11): his words, to play on or not to promise, never an order. */
  | 'fan_fantasy'
  /** A supplement of her custom grid (ADR 0159 § C): the owner's name for it, a box for the brain, never an order. */
  | 'custom_supplement'
  /** The script step code decided to send now (ADR 0098 § 5): its kind, the agency's instruction, the price, the media. */
  | 'script_step'
  /** The paid step waiting for him, when he asks how to pay (ADR 0156 § 4): its price and what it holds. */
  | 'waiting_step'
  /**
   * A comment left under one of her Instagram posts, and that post's caption (ADR 0122 § 2): a third party's words
   * and hers, read as data, never as an order.
   */
  | 'instagram_comment'
  | 'instagram_caption'
  /** Her validated replies to comments (ADR 0122 § 4): the examples of the Playground's bank. */
  | 'comment_examples'
  /** Her bio on her platform profile (ADR 0154): the text every subscriber could read, data, never an order. */
  | 'profile_bio'
  /** Her real replies to comments close to the one at hand (Charles, 26/11): imported by the owner, read as data. */
  | 'her_replies'
  /** Her recent replies to comments: written by the model from comments that may have steered it, read as data. */
  | 'recent_replies'
  /**
   * What a caption is written from (ADR 0164 § 9): her past captions, the sentence she wrote with her drop and her
   * own hints for other ideas. Hers, still read as data, never as an order.
   */
  | 'caption_examples'
  | 'creator_sentence'
  | 'caption_hints'
  /**
   * The simulated fan's test (ADR 0172): her messages as the invented fan reads them, which may try to steer
   * him; the whole conversation and his inner journal as the relationship judge reads them. Data, never an order.
   */
  | 'creator_message'
  | 'simulated_conversation'
  | 'fan_journal';

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
