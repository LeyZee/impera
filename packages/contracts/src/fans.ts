import { z } from 'zod';

import { FanIdSchema } from './ids';

/**
 * What she tries to learn about a fan (P3-02): the lines of the agency's notes canvas on Reveal, as they are.
 * A slot is filled by an active fact of the same key (`fan_facts.key`).
 */
export const KycSlotSchema = z.enum([
  'first_name',
  'location',
  'age',
  'job',
  'hobbies',
  'desires',
  'situation',
]);
export type KycSlot = z.infer<typeof KycSlotSchema>;

/** The canvas line of each slot, word for word. */
export const KYC_SLOT_LABELS: Readonly<Record<KycSlot, string>> = {
  first_name: 'Prénom',
  location: 'Localisation',
  age: 'Âge',
  job: 'Métier',
  hobbies: 'Passions',
  desires: 'Envies',
  situation: 'Situation',
};

/**
 * `GET /v1/fans/:id/kyc?creatorId=` (P5-01): the canvas lines she has still to learn about him, among those her persona
 * collects (`strategies.kyc.collect`, all of them otherwise), in her order. A line is learnt once an active fact has
 * its slot as key; the Suivi says « À apprendre : Localisation, Métier », and nothing once the list is empty.
 */
export const FanKycViewSchema = z.object({ fanId: FanIdSchema, toLearn: z.array(KycSlotSchema) });
export type FanKycView = z.infer<typeof FanKycViewSchema>;

/** Why sales stopped for a fan: what he said, or a human's call. */
export const SalesFreezeReasonSchema = z.enum(['money_trouble', 'spending_limit', 'distress', 'operator']);
export type SalesFreezeReason = z.infer<typeof SalesFreezeReasonSchema>;

/**
 * Limits of a fan (`fans.flags`), read by the policy before any offer. Written by the policy when it detects a
 * risk, or by a human, never by a model alone; each change is a `domain_events` line with its author.
 */
export const FanFlagsSchema = z
  .object({
    /** When he was confirmed an adult: nothing explicit before. */
    ageConfirmedAt: z.iso.datetime().exactOptional(),
    /**
     * His age was taken back (a sign of a minor, or a human): his own statement no longer confirms it. Set with each
     * removal of `ageConfirmedAt`, lifted only by a human (P3-09).
     */
    ageDisputed: z.object({ since: z.iso.datetime(), by: z.enum(['policy', 'human']) }).exactOptional(),
    /** No offer, no sulking, no sales follow-up. */
    salesFrozen: z.object({ reason: SalesFreezeReasonSchema, since: z.iso.datetime() }).exactOptional(),
    /** A ceiling he set himself, in cents. */
    spendingLimitMinor: z.number().int().nonnegative().exactOptional(),
    /** Gentle only: no sulking either. */
    fragile: z.literal(true).exactOptional(),
    /** Suggestive only, never explicit, whatever his age (a human's call). */
    noExplicit: z.literal(true).exactOptional(),
    /** Nothing is written to him at all. */
    doNotContact: z.literal(true).exactOptional(),
  })
  .strict();
export type FanFlags = z.infer<typeof FanFlagsSchema>;

/** The name of one flag of a fan: what `fan_flag_set` and `fan_flag_cleared` say changed. */
export const FanFlagNameSchema = FanFlagsSchema.keyof();
export type FanFlagName = z.infer<typeof FanFlagNameSchema>;

/**
 * The limits a person or the policy lifts directly. Not `ageDisputed`: a dispute ends only when the owner or an active
 * manager confirms his age, with a reason (SUIVI-04); lifting it alone would let anyone confirm him after.
 */
export const ClearableFanFlagNameSchema = FanFlagNameSchema.exclude(['ageDisputed']);
export type ClearableFanFlagName = z.infer<typeof ClearableFanFlagNameSchema>;

/**
 * `GET /v1/fans/:id/flags`, and the answer of `PUT`: his limits now, and whether the reader may confirm his age once
 * it is disputed (a sign of a minor): the owner and an active manager only, with a written reason (SUIVI-04).
 */
export const FanFlagsViewSchema = z.object({
  fanId: FanIdSchema,
  flags: FanFlagsSchema,
  mayConfirmDisputedAge: z.boolean(),
});
export type FanFlagsView = z.infer<typeof FanFlagsViewSchema>;

const flagReason = z.string().trim().min(1).max(500).exactOptional();

/**
 * The highest ceiling a person sets, in cents (100 000 €): past it, a typing slip rather than his word. A ceiling of
 * 0 € is no ceiling but a freeze, which `salesFrozen` says.
 */
export const SPENDING_LIMIT_MAX_MINOR = 10_000_000;

/**
 * Refusals of `PUT /v1/fans/:id/flags` on a disputed age: not the owner nor an active manager (403), or no written
 * reason (400). The screen says which.
 */
export const AGE_DISPUTE_FORBIDDEN = 'age_dispute_forbidden';
export const AGE_DISPUTE_REASON_INVALID = 'age_dispute_reason_invalid';

/**
 * `PUT /v1/fans/:id/flags`: a human sets or lifts one limit. The server dates `ageConfirmedAt` and the start of a
 * freeze itself; a freeze says why, a ceiling says how much.
 */
export const SetFanFlagBodySchema = z.union([
  z.object({
    flag: z.enum(['ageConfirmedAt', 'fragile', 'noExplicit', 'doNotContact']),
    set: z.literal(true),
    reason: flagReason,
  }),
  z.object({
    flag: z.literal('salesFrozen'),
    set: z.literal(true),
    freezeReason: SalesFreezeReasonSchema,
    reason: flagReason,
  }),
  z.object({
    flag: z.literal('spendingLimitMinor'),
    set: z.literal(true),
    limitMinor: z.number().int().positive().max(SPENDING_LIMIT_MAX_MINOR),
    reason: flagReason,
  }),
  z.object({ flag: ClearableFanFlagNameSchema, set: z.literal(false), reason: flagReason }),
]);
export type SetFanFlagBody = z.infer<typeof SetFanFlagBodySchema>;
