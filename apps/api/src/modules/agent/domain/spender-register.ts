import type { FanTier } from '@impera/contracts';

/**
 * Her register with a fan who spends with her (ADR 0132 § 7, `SpenderRegister`): warm as with everyone, close (she remembers, asks
 * after him, says he was missed), or girlfriend (tender, attentive, more intimate and more present than with the
 * others). Code chooses it from his tier, never the brain, and the brain never reads his tier: no fan is a wallet.
 * Charles, 26/11: a whale is girlfriend, a very good payer close, a good payer warm as today.
 */
export type SpenderRegister = 'warm' | 'close' | 'girlfriend';

const TIER_REGISTER: Readonly<Record<FanTier, SpenderRegister>> = {
  new: 'warm',
  payer: 'warm',
  good: 'warm',
  very_good: 'close',
  whale: 'girlfriend',
};

export interface SpenderRegisterLimits {
  /** A human marked him fragile: a closer register is what makes a sale to him dangerous (ADR 0132 § 13). */
  readonly fragile: boolean;
  /** He is in care (ADR 0088): no register above the plain one, a human looks after him. */
  readonly care: boolean;
  /** His sales are frozen because he cannot pay (`money_trouble`): bounded to close (ADR 0132 § 13). */
  readonly moneyTrouble: boolean;
}

/**
 * His register: from his tier; bounded to close when he is fragile or short of money, plain in care. Unknown tier,
 * plain warm (fail safe: nothing changes).
 */
export function spenderRegisterOf(
  tier: FanTier | null | undefined,
  limits: SpenderRegisterLimits,
): SpenderRegister {
  if (limits.care || tier === null || tier === undefined) return 'warm';
  const chosen = TIER_REGISTER[tier];
  return chosen === 'girlfriend' && (limits.fragile || limits.moneyTrouble) ? 'close' : chosen;
}
