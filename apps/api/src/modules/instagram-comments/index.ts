/**
 * Public entry point of the `instagram-comments` module (INS-04, ADR 0122). Other modules import this file only.
 * Lot a: its pure rules and its port; no route, no table, no job yet.
 */
export {
  InstagramRefusal,
  type InstagramCommentCapabilities,
  type InstagramCommentsPort,
  type InstagramRefusalKind,
} from './domain/ports';
/** @public The guards of a public reply, wired with the voice at lot c. */
export {
  CHAT_GUARDS_ON_A_REPLY,
  checkReply,
  type ReplyGuardContext,
  type ReplyViolation,
} from './domain/reply-guards';
/** @public What the code decides around the model, wired with the jobs at lot b. */
export {
  afterGuards,
  beforeModel,
  handoffDelivery,
  hostileCommentAction,
  mayDeleteComment,
  type AfterGuards,
  type BeforeModel,
  type CommentFacts,
  type GuardedAttempt,
  type ReplyBounds,
} from './domain/outcome';
/** @public The readiness for autonomy, read by the settings at lot b and the Playground's counter at lot d. */
export {
  autonomyReadiness,
  boundedThresholds,
  DEFAULT_AUTONOMY_THRESHOLDS,
  refusalsSwitchAutonomyOff,
  type AutonomyReadiness,
  type AutonomyThresholds,
} from './domain/autonomy';
/** @public Her questions in public, one reply in a few at most, wired with the jobs at lot b. */
export {
  asksAQuestion,
  boundedQuestionEvery,
  mayAskQuestion,
  QUESTION_EVERY_BOUNDS,
} from './domain/questions';
/** @public What the code prepares for the model and does without it, wired with the jobs at lot b. */
export {
  captionForPrompt,
  commentForPrompt,
  outcomeWithoutModel,
  promptInputOf,
  type CommentPromptFacts,
} from './domain/prompt-input';
