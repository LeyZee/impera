import { z } from 'zod';

import { AgentModeSchema } from './dashboard';
import { CreatorIdSchema, TeamMemberIdSchema } from './ids';
import { InvoiceNotIssuedReasonSchema } from './invoices-vocabulary';
import { TeamRoleSchema } from './team';

/**
 * « Mise en route » (pilotage plan W1, 12/11): everything to set up before a creator or a team member runs, each step
 * ticked by the server from what the base holds, never by a click. The owner's alone. The screen only lays it out: it
 * never decides that a step is done.
 */

/** `waiting`: started, it waits on someone else (an invitation not opened yet). */
export const SetupStateSchema = z.enum(['done', 'todo', 'waiting']);
export type SetupState = z.infer<typeof SetupStateSchema>;

/** A creator's steps, in the order they are done. */
export const CREATOR_SETUP_STEPS = [
  'platform_account',
  'persona',
  'agency_rate',
  'access',
  'pay_rules',
  'telegram',
  'agent_hours',
  'shifts',
  'agent_mode',
  'reliability_check',
] as const;
export const CreatorSetupStepKeySchema = z.enum(CREATOR_SETUP_STEPS);
export type CreatorSetupStepKey = z.infer<typeof CreatorSetupStepKeySchema>;

/**
 * A member's steps; a manager has no extension, platform account nor shift to set up, and « Facturation » is for a
 * paid member only (a chatter, or a manager with a rate or a share of the team's net).
 */
export const MEMBER_SETUP_STEPS = [
  'invitation',
  'second_factor',
  'extension',
  'platform_account',
  'creators',
  'first_shift',
  'billing',
] as const;
export const MemberSetupStepKeySchema = z.enum(MEMBER_SETUP_STEPS);
export type MemberSetupStepKey = z.infer<typeof MemberSetupStepKeySchema>;

/**
 * What a step adds when its state alone says too little: hours left on the defaults, the agent's mode in force, how
 * many of her accounts have pay rules, Telegram off, a latest reliability check that is not clean.
 */
export const SetupNoteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default_hours') }),
  z.object({ kind: z.literal('agent_mode'), mode: AgentModeSchema }),
  z.object({
    kind: z.literal('accounts'),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('telegram_off') }),
  z.object({ kind: z.literal('check_not_clean') }),
  /** An invitation link was made, none is alive any more and no password was chosen: it has to be sent again. */
  z.object({ kind: z.literal('invitation_expired') }),
  /** What stops his first invoice today, the reason the validation would give (`invoice_not_issued`). */
  z.object({ kind: z.literal('billing'), reason: InvoiceNotIssuedReasonSchema }),
]);
export type SetupNote = z.infer<typeof SetupNoteSchema>;

export const CreatorSetupStepSchema = z.object({
  key: CreatorSetupStepKeySchema,
  state: SetupStateSchema,
  note: SetupNoteSchema.nullable(),
});
export type CreatorSetupStep = z.infer<typeof CreatorSetupStepSchema>;

export const MemberSetupStepSchema = z.object({
  key: MemberSetupStepKeySchema,
  state: SetupStateSchema,
  note: SetupNoteSchema.nullable(),
});
export type MemberSetupStep = z.infer<typeof MemberSetupStepSchema>;

/** `GET /v1/dashboard/setup/creators`: every creator not archived, the owner's. */
export const CreatorSetupSchema = z.object({
  creatorId: CreatorIdSchema,
  steps: z.array(CreatorSetupStepSchema),
});
export type CreatorSetup = z.infer<typeof CreatorSetupSchema>;
export const CreatorSetupListSchema = z.object({ creators: z.array(CreatorSetupSchema) });
export type CreatorSetupList = z.infer<typeof CreatorSetupListSchema>;

/**
 * `GET /v1/dashboard/setup/members`: every member who has not left, for the owner; an active manager gets the chatters
 * alone, without « Facturation » (he never reads another member's file).
 */
export const MemberSetupSchema = z.object({
  memberId: TeamMemberIdSchema,
  teamRole: TeamRoleSchema,
  steps: z.array(MemberSetupStepSchema),
});
export type MemberSetup = z.infer<typeof MemberSetupSchema>;
export const MemberSetupListSchema = z.object({ members: z.array(MemberSetupSchema) });
export type MemberSetupList = z.infer<typeof MemberSetupListSchema>;

/** Nothing left: the list leaves the screen. */
export const isSetupComplete = (steps: readonly { readonly state: SetupState }[]): boolean =>
  steps.every((step) => step.state === 'done');
