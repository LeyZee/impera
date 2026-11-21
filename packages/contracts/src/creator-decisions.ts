import { z } from 'zod';

import { CreatorTaskCategorySchema } from './creator-tasks';
import { CreatorDecisionIdSchema, CreatorIdSchema } from './ids';

/*
 * « À décider », hers (ADR 0162): one question put to her at a time on top of Aujourd'hui, about a content of hers,
 * with two or three answers and « Plus tard ». The code that asks decides what an answer does; this contract is only
 * what she reads and what she sends back. The owner answers in her place when she does not.
 */

/** What a decision is about; the code that asks it reads her answer. A closed list: a new question is a new kind. */
export const CREATOR_DECISION_KINDS = ['caption', 'publish_time', 'trial_reel'] as const;
export const CreatorDecisionKindSchema = z.enum(CREATOR_DECISION_KINDS);
export type CreatorDecisionKind = z.infer<typeof CreatorDecisionKindSchema>;

/** `buttons`: two or three short answers. `rows`: each answer is a text she reads in full (three captions). */
export const DECISION_LAYOUTS = ['buttons', 'rows'] as const;
export const DecisionLayoutSchema = z.enum(DECISION_LAYOUTS);
export type DecisionLayout = z.infer<typeof DecisionLayoutSchema>;

export const DECISION_STATES = ['open', 'answered', 'withdrawn'] as const;
export const DecisionStateSchema = z.enum(DECISION_STATES);
export type DecisionState = z.infer<typeof DecisionStateSchema>;

/** How many answers a decision holds: a choice, never a list. */
export const DECISION_ANSWERS_MIN = 2;
export const DECISION_ANSWERS_MAX = 3;
/** How many times she may ask for other ideas on one decision. */
export const DECISION_OTHER_IDEAS_MAX = 3;
/** « Plus tard »: how long the question stays aside before it comes back, never past its end. */
export const DECISION_LATER_MINUTES = 120;
/** The most open decisions she is shown: the rest waits its turn. */
export const DECISIONS_SHOWN_MAX = 10;

/** How an answer is named between her phone and the server; never shown. */
export const DecisionAnswerKeySchema = z.string().regex(/^[a-z0-9_]{1,24}$/u);

export const DecisionAnswerSchema = z.strictObject({
  key: DecisionAnswerKeySchema,
  /** A button's words, or the style of a row (« Taquine »). */
  label: z.string().trim().min(1).max(40),
  /** The text of a row, whole; `null` on a button. */
  text: z.string().trim().min(1).max(2200).nullable(),
  /** What she reads once she chose it (« C’est noté. Je publie à 18 h 30. »). */
  noted: z.string().trim().min(1).max(140),
});
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;

/** The answers of one decision: two or three, each key once, a text on every row and on no button. */
const decisionAnswersSchema = (layout: DecisionLayout) =>
  z
    .array(DecisionAnswerSchema)
    .min(DECISION_ANSWERS_MIN)
    .max(DECISION_ANSWERS_MAX)
    .refine((answers) => new Set(answers.map((answer) => answer.key)).size === answers.length, {
      message: 'each answer key once',
    })
    .refine((answers) => answers.every((answer) => (answer.text !== null) === (layout === 'rows')), {
      message: 'a text on every row, none on a button',
    });

const QuestionSchema = z.string().trim().min(1).max(120);
const ContextSchema = z.string().trim().min(1).max(200);

/** A decision as she reads it. */
export const CreatorDecisionSchema = z.strictObject({
  id: CreatorDecisionIdSchema,
  kind: CreatorDecisionKindSchema,
  /** The colour of the content it is about, her agenda's. */
  category: CreatorTaskCategorySchema,
  question: QuestionSchema,
  context: ContextSchema,
  layout: DecisionLayoutSchema,
  answers: z.array(DecisionAnswerSchema).min(DECISION_ANSWERS_MIN).max(DECISION_ANSWERS_MAX),
  /** How many times she may still ask for other ideas; 0 hides the gesture. */
  otherIdeasLeft: z.number().int().min(0).max(DECISION_OTHER_IDEAS_MAX),
});
export type CreatorDecision = z.infer<typeof CreatorDecisionSchema>;

/** `GET /v1/creator-space/decisions`: what waits on her now, the one that ends first on top. */
export const CreatorDecisionsSchema = z.strictObject({
  decisions: z.array(CreatorDecisionSchema).max(DECISIONS_SHOWN_MAX),
});
export type CreatorDecisions = z.infer<typeof CreatorDecisionsSchema>;

export const CreatorDecisionParamsSchema = z.strictObject({ id: CreatorDecisionIdSchema });

/** `POST /v1/creator-space/decisions/:id/answer`. */
export const AnswerDecisionBodySchema = z.strictObject({ answer: DecisionAnswerKeySchema });
export type AnswerDecisionBody = z.infer<typeof AnswerDecisionBodySchema>;

/** What a code that asks gives: the decision, how it is named for a replay, and when it stops making sense. */
export const NewCreatorDecisionSchema = z
  .strictObject({
    kind: CreatorDecisionKindSchema,
    /** What it is about, named by who asks (`reel:<id>`): asked twice, it is written once. */
    subject: z.string().regex(/^[a-z_]{1,24}:[0-9a-f-]{36}$/u),
    category: CreatorTaskCategorySchema,
    question: QuestionSchema,
    context: ContextSchema,
    layout: DecisionLayoutSchema,
    answers: z.array(DecisionAnswerSchema),
    otherIdeasLeft: z.number().int().min(0).max(DECISION_OTHER_IDEAS_MAX),
    expiresAt: z.iso.datetime(),
  })
  .superRefine((decision, context) => {
    const answers = decisionAnswersSchema(decision.layout).safeParse(decision.answers);
    if (!answers.success)
      context.addIssue({ code: 'custom', path: ['answers'], message: 'answers do not fit the layout' });
  });
export type NewCreatorDecision = z.infer<typeof NewCreatorDecisionSchema>;

/** What she reads once her answer is kept. */
export const AnsweredDecisionSchema = z.strictObject({ noted: z.string().min(1).max(140) });
export type AnsweredDecision = z.infer<typeof AnsweredDecisionSchema>;

/** The owner's routes, in her place: `/v1/creators/:creatorId/decisions`. */
export const AgencyDecisionsParamsSchema = z.strictObject({ creatorId: CreatorIdSchema });
export const AgencyDecisionParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  id: CreatorDecisionIdSchema,
});
