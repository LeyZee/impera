import {
  COMMENT_REPLY_MAX,
  instagramFaults,
  nudityIn,
  type CommentGuardCode,
  type GuardCode,
} from '@impera/contracts';

/**
 * The guards of a public reply (ADR 0122 § 3), in the code: a reply is read by anyone, from the age of 13. It passes
 * the Instagram guard of her captions, the chatting guards that still apply in public, and two of its own:
 * `public_explicit` and `repeated_reply`.
 */

/**
 * The chatting guards the ADR names for a public reply (§ 3): the tested minimum, not a whitelist. The wiring hands
 * over every blocking code the chatting guards raise on the text, and each one refuses the reply, so a guard added to
 * the chatting later holds here too.
 */
export const CHAT_GUARDS_ON_A_REPLY = [
  'ai_disclosure',
  'meeting_promise',
  'love_declaration',
  'contact_info',
  'discount',
] as const satisfies readonly GuardCode[];

export interface ReplyViolation {
  readonly code: CommentGuardCode | GuardCode;
  /** What was found, for the audit of a refusal: a rule's own name or word, never the commenter's text. */
  readonly detail: string;
}

export interface ReplyGuardContext {
  /** Her replies under the same post or of the same day, the most recent ones. */
  readonly recentReplies: readonly string[];
  /** The blocking codes the chatting guards raise on this text: each one refuses the reply. */
  readonly chatGuardCodes: readonly GuardCode[];
}

const EMOJI = /\p{Extended_Pictographic}/gu;
// Anywhere in the text, full-width forms folded: a public mention notifies a third party.
const HASHTAG_OR_MENTION = /[#@][\p{L}\p{N}_]/u;

// Words of seduction or sex, on the folded text: a public reply is warm, never seductive.
const SEDUCTION = [
  'sexy',
  'coquin',
  'coquine',
  'excite',
  'excitee',
  'envie de toi',
  'dans mon lit',
  'en prive',
  'en dm',
  'mon coeur',
  'bebe',
  'cheri',
  'embrasse partout',
  'baiser',
  'baise',
  'jouir',
  'caresse',
  'caresses',
  'culotte',
  'lingerie',
  'fantasme',
  'fantasmes',
  'te montrer plus',
  'voir plus de moi',
];

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function seductionIn(text: string): string | null {
  const haystack = ` ${fold(text)} `;
  return SEDUCTION.find((word) => haystack.includes(` ${word} `)) ?? null;
}

/** Two replies are the same, or nearly: same folded text, or four words in five shared. */
function nearlySame(left: string, right: string): boolean {
  const a = fold(left);
  const b = fold(right);
  if (a === '' || b === '') return a === b;
  if (a === b) return true;
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  if (wordsA.size < 3 || wordsB.size < 3) return false;
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / new Set([...wordsA, ...wordsB]).size >= 0.8;
}

/** What refuses `text` as a public reply, empty when it passes. */
export function checkReply(text: string, context: ReplyGuardContext): ReplyViolation[] {
  const violations: ReplyViolation[] = [];
  const reply = text.trim();
  if (reply === '' || reply.length > COMMENT_REPLY_MAX)
    violations.push({ code: 'comment_format', detail: 'length' });
  if ((reply.match(EMOJI) ?? []).length > 1) violations.push({ code: 'comment_format', detail: 'emojis' });
  if (HASHTAG_OR_MENTION.test(reply.normalize('NFKC')))
    violations.push({ code: 'comment_format', detail: 'hashtag_or_mention' });
  for (const fault of instagramFaults(reply)) violations.push({ code: 'instagram_text', detail: fault });
  const explicit = nudityIn(reply) ?? seductionIn(reply);
  if (explicit !== null) violations.push({ code: 'public_explicit', detail: explicit });
  if (context.recentReplies.some((earlier) => nearlySame(earlier, reply)))
    violations.push({ code: 'repeated_reply', detail: 'recent_reply' });
  for (const code of new Set(context.chatGuardCodes)) violations.push({ code, detail: code });
  return violations;
}
