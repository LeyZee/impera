import { z } from 'zod';

/**
 * The fan's availability (ADR 0103, amendement du 13/11, glossary « Disponibilité du fan »): whether he is in a state
 * to receive a sale, alone, at home, free for a while and without an appointment. A state held by the agent's code
 * from the brain's closed signals, kept on the conversation (`fan_availability`) and shown at the playground beside
 * his desire score. No script starts, first teaser included, while it is not confirmed.
 */

export const FAN_AVAILABILITY_STATES = ['confirmed', 'unknown', 'no'] as const;
export const FanAvailabilityStateSchema = z.enum(FAN_AVAILABILITY_STATES);
export type FanAvailabilityState = z.infer<typeof FanAvailabilityStateSchema>;

/** What the brain may read of his availability in his last message (among `desireSignals`). */
export const FAN_AVAILABILITY_POSITIVE_SIGNALS = ['alone', 'at_home', 'free_now'] as const;
export const FAN_AVAILABILITY_NEGATIVE_SIGNALS = ['someone_nearby', 'busy_now', 'leaving_soon'] as const;
export const FAN_AVAILABILITY_SIGNALS = [
  ...FAN_AVAILABILITY_POSITIVE_SIGNALS,
  ...FAN_AVAILABILITY_NEGATIVE_SIGNALS,
] as const;
export const FanAvailabilitySignalSchema = z.enum(FAN_AVAILABILITY_SIGNALS);
export type FanAvailabilitySignal = z.infer<typeof FanAvailabilitySignalSchema>;

/** His availability as screens read it: the state, the signal that set it, when, and when it lapses. */
export const FanAvailabilitySchema = z.object({
  state: FanAvailabilityStateSchema,
  signal: FanAvailabilitySignalSchema.nullable(),
  at: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
});
export type FanAvailability = z.infer<typeof FanAvailabilitySchema>;

/**
 * What the conversation keeps (`conversations.fan_availability`, event `fan_availability_changed`): his availability,
 * plus what the session remembers for the script gate. `seen`: his positive signals in the session (he says « seul »,
 * then « j'ai le temps »). `sexualizedAt`: the last message of his that sexualized. `askedAt`: when she last asked
 * whether he is free (once per session). `hotAt`: when his desire first reached her script threshold in the session, so
 * that the session's end (his heat back under it) is known.
 */
export const FanAvailabilityRecordSchema = FanAvailabilitySchema.extend({
  seen: z.array(z.enum(FAN_AVAILABILITY_POSITIVE_SIGNALS)).max(FAN_AVAILABILITY_POSITIVE_SIGNALS.length),
  sexualizedAt: z.coerce.date().nullable(),
  askedAt: z.coerce.date().nullable(),
  hotAt: z.coerce.date().nullable(),
});
export type FanAvailabilityRecord = z.infer<typeof FanAvailabilityRecordSchema>;

/** Why no script may start yet (ADR 0103 § 11), in the order they are checked. */
export const SCRIPT_START_BLOCKS = [
  'desire_below_threshold',
  'not_sexualizing',
  'availability_unconfirmed',
] as const;
export const ScriptStartBlockSchema = z.enum(SCRIPT_START_BLOCKS);
export type ScriptStartBlock = z.infer<typeof ScriptStartBlockSchema>;

/** The gate before the first teaser: open, or what is missing (every condition missing, in order). */
export const ScriptStartSchema = z.discriminatedUnion('open', [
  z.object({ open: z.literal(true) }),
  z.object({ open: z.literal(false), missing: z.array(ScriptStartBlockSchema).min(1).max(3) }),
]);
export type ScriptStart = z.infer<typeof ScriptStartSchema>;
