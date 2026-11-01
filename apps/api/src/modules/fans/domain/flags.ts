import {
  FanFlagsSchema,
  type FanFlagName,
  type FanFlags,
  type SetFanFlagBody,
  type TeamScope,
} from '@nirvana/contracts';

import { AgeDisputeForbidden, AgeDisputeReasonInvalid } from './errors';

/** Who may change a fan's limits: a human or the policy, never a model alone (P3-02). */
export type FlagAuthor = 'system' | `human:${string}`;

/** One limit to set, with its value (`true` for the switches). */
export type FlagChange = {
  readonly [K in FanFlagName]: { readonly flag: K; readonly value: NonNullable<FanFlags[K]> };
}[FanFlagName];

/** Already true as asked: a confirmation keeps its first date, a freeze for the same reason keeps its start. */
function alreadySet(flags: FanFlags, change: FlagChange): boolean {
  if (change.flag === 'ageConfirmedAt') return flags.ageConfirmedAt !== undefined;
  if (change.flag === 'salesFrozen') return flags.salesFrozen?.reason === change.value.reason;
  return JSON.stringify(flags[change.flag]) === JSON.stringify(change.value);
}

/** His limits with this one set, or `null` when it already was (nothing to write, no event). */
export function withFlag(flags: FanFlags, change: FlagChange): FanFlags | null {
  if (alreadySet(flags, change)) return null;
  return FanFlagsSchema.parse({ ...flags, [change.flag]: change.value });
}

/**
 * His limits with this one set only where it was not set at all, or `null`: a freeze a human set keeps its reason
 * when the policy would add its own. Read under the row lock, so nothing can slip in between.
 */
export function withFlagIfUnset(flags: FanFlags, change: FlagChange): FanFlags | null {
  return flags[change.flag] === undefined ? withFlag(flags, change) : null;
}

/**
 * His age taken back: no confirmation, and disputed so that his own statement no longer confirms it. Written even
 * when his age was not confirmed yet (a sign of a minor before any statement); a dispute keeps its first date.
 */
export function withAgeDisputed(flags: FanFlags, by: 'policy' | 'human', now: Date): FanFlags | null {
  if (flags.ageConfirmedAt === undefined && flags.ageDisputed !== undefined) return null;
  const rest = Object.fromEntries(Object.entries(flags).filter(([name]) => name !== 'ageConfirmedAt'));
  return FanFlagsSchema.parse({
    ...rest,
    ageDisputed: flags.ageDisputed ?? { since: now.toISOString(), by },
  });
}

/** The owner and an active manager may lift a disputed age; anyone else, or an unknown account, may not. */
export const mayConfirmDisputedAge = (scope: TeamScope | null): boolean =>
  scope === 'owner' || scope === 'agency';

/** Who confirms, as the database says (`withTenantMember`), and the reason they wrote, if any. */
export interface Confirmer {
  readonly scope: TeamScope | null;
  readonly reason?: string;
}

/**
 * A human confirms his age: that settles a dispute too. A disputed age (a sign of a minor) is confirmed only by the
 * owner or an active manager, with a written reason (SUIVI-04); refused otherwise, under the row lock, nothing written.
 */
export function withHumanConfirmation(
  flags: FanFlags,
  change: FlagChange,
  confirmer: Confirmer,
): FanFlags | null {
  const confirmed = withFlag(flags, change);
  if (flags.ageDisputed === undefined) return confirmed;
  if (!mayConfirmDisputedAge(confirmer.scope)) throw new AgeDisputeForbidden();
  if (confirmer.reason === undefined || confirmer.reason.trim() === '') throw new AgeDisputeReasonInvalid();
  const rest = Object.fromEntries(
    Object.entries(confirmed ?? flags).filter(([name]) => name !== 'ageDisputed'),
  );
  return FanFlagsSchema.parse(rest);
}

/** His own adult statement confirms his age, only where nothing was confirmed and nothing taken back (P3-09). */
export function withDeclaredAge(flags: FanFlags, at: Date): FanFlags | null {
  if (flags.ageConfirmedAt !== undefined || flags.ageDisputed !== undefined) return null;
  return FanFlagsSchema.parse({ ...flags, ageConfirmedAt: at.toISOString() });
}

/**
 * His limits without this one, or `null` when it was not set. Never `ageDisputed`: only a confirmation by the owner or
 * a manager ends a dispute (`withHumanConfirmation`).
 */
export function withoutFlag(flags: FanFlags, flag: FanFlagName): FanFlags | null {
  if (flag === 'ageDisputed') throw new AgeDisputeForbidden();
  if (flags[flag] === undefined) return null;
  return FanFlagsSchema.parse(Object.fromEntries(Object.entries(flags).filter(([name]) => name !== flag)));
}

/** A human's request (`PUT /v1/fans/:id/flags`) to set a limit: the server dates the confirmation and the freeze. */
export function requestedChange(body: Extract<SetFanFlagBody, { set: true }>, now: Date): FlagChange {
  switch (body.flag) {
    case 'ageConfirmedAt':
      return { flag: 'ageConfirmedAt', value: now.toISOString() };
    case 'salesFrozen':
      return { flag: 'salesFrozen', value: { reason: body.freezeReason, since: now.toISOString() } };
    case 'spendingLimitMinor':
      return { flag: 'spendingLimitMinor', value: body.limitMinor };
    case 'fragile':
    case 'noExplicit':
    case 'doNotContact':
      return { flag: body.flag, value: true };
  }
}
