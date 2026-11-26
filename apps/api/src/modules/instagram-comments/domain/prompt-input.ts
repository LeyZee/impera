import {
  COMMENT_PROMPT_CAPTION_MAX,
  COMMENT_PROMPT_TEXT_MAX,
  type CommentOutcome,
  type CommentPromptInput,
  type InstagramMediaKind,
} from '@impera/contracts';

/**
 * What the code prepares for the model (ADR 0122 § 2): the two texts cut and cleaned, and the facts beside. A handle
 * written in a comment or a caption names a third party: it is removed before the model reads anything.
 */

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/giu;
const MENTION = /@[\p{L}\p{N}_.]+/gu;

/** Cut by UTF-16 units, as the schemas count; a pair split by the cut loses its orphan half. */
function cut(text: string, max: number): string {
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/u, '');
}

function tidy(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** A comment as the model reads it: third parties' handles removed, cut to its bound. */
export function commentForPrompt(text: string): string {
  return cut(tidy(text.normalize('NFKC').replace(MENTION, ' ')), COMMENT_PROMPT_TEXT_MAX);
}

/** Her caption as the model reads it: links and mentions removed, cut to its bound. */
export function captionForPrompt(caption: string): string {
  return cut(
    tidy(caption.normalize('NFKC').replace(LINK, ' ').replace(MENTION, ' ')),
    COMMENT_PROMPT_CAPTION_MAX,
  );
}

export interface CommentPromptFacts {
  readonly text: string;
  readonly caption: string;
  readonly mediaKind: InstagramMediaKind;
  readonly postedAt: Date;
  readonly now: Date;
  readonly repliesToHer: boolean;
  readonly authorCommentedBefore: boolean;
  /** From `mayAskQuestion`, on her replies of the day. */
  readonly mayAsk: boolean;
}

export function promptInputOf(facts: CommentPromptFacts): CommentPromptInput {
  const hours = Math.floor((facts.now.getTime() - facts.postedAt.getTime()) / 3_600_000);
  return {
    comment: commentForPrompt(facts.text),
    mediaKind: facts.mediaKind,
    caption: captionForPrompt(facts.caption),
    postAgeHours: Math.max(0, hours),
    repliesToHer: facts.repliesToHer,
    authorCommentedBefore: facts.authorCommentedBefore,
    mayAsk: facts.mayAsk,
  };
}

/**
 * When the model gave nothing usable. Over the day's cap no model is called: the comment gets no reply. An output
 * still invalid after the fallback goes to a human: the code never repairs a text.
 */
export function outcomeWithoutModel(failure: 'budget_reached' | 'model_failed'): CommentOutcome {
  return failure === 'budget_reached'
    ? { kind: 'skip', reason: 'daily_cap_reached' }
    : { kind: 'handoff', handoff: 'other', reason: 'model_failed' };
}
