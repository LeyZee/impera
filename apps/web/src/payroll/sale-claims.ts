import {
  SALE_CLAIMS_WAITING_MAX,
  type SaleClaim,
  type SaleClaimShift,
  type SaleClaimState,
} from '@impera/contracts';

import { accountLine, swapShiftLine } from '@/scheduling/model';

/** The longest note a claim or a « Pas retenu » keeps (`SALE_CLAIM_NOTE_MAX`). */
export const CLAIM_NOTE_MAX = 500;

const NBSP = ' ';

/** Where a claim stands, as the member and the validator read it (ADR 0101 § 20). */
export const CLAIM_STATE_LABELS: Readonly<Record<SaleClaimState, string>> = {
  waiting: 'En attente',
  settled: 'Réglé',
  not_retained: 'Pas retenu',
  withdrawn: 'Retiré',
};

/** « Nora Vidal · @nora sur Reveal · sam. 21 nov. · 14 h 05 – 20 h 05 »: the shift a claim is about. */
/** The two lines of a shift to choose: its day and hours first, its creator and account under them. */
export function claimShiftParts(
  shift: SaleClaimShift,
  zone: string,
): { readonly when: string; readonly where: string } {
  return {
    when: swapShiftLine(shift.startsAt, shift.endsAt, undefined, zone),
    where: `${shift.creatorName} · ${accountLine(shift)}`,
  };
}

/** A member's note as quoted: French guillemets held to their words, never a « » alone on a line. */
export const quoted = (note: string): string => `«${NBSP}${note}${NBSP}»`;

export function claimShiftLine(shift: SaleClaimShift, zone: string): string {
  return `${shift.creatorName} · ${accountLine(shift)} · ${swapShiftLine(shift.startsAt, shift.endsAt, undefined, zone)}`;
}

/** The waiting claims of a member: three at most (§ 21), the fourth waits for an answer. */
export const claimsWaiting = (claims: readonly Pick<SaleClaim, 'state'>[]): number =>
  claims.filter((one) => one.state === 'waiting').length;

/** Why « Signaler un shift » is off, or `null` when it is on. */
export function claimBlockedText(
  claims: readonly Pick<SaleClaim, 'state'>[],
  shifts: readonly unknown[],
): string | null {
  if (claimsWaiting(claims) >= SALE_CLAIMS_WAITING_MAX)
    return `Tu as ${String(SALE_CLAIMS_WAITING_MAX)}${NBSP}signalements en attente : un manager y répond avant le suivant.`;
  if (shifts.length === 0) return 'Aucun shift fini ces 15 derniers jours à signaler.';
  return null;
}

/** The validator's head of the panel: « 2 en attente ». */
export const pendingCountText = (count: number): string => `${String(count)}${NBSP}en attente`;

/**
 * What the member reads under his claim, beside its state's tag: who answered is not his to know, the word of a refusal
 * is. The tag already says the state: the line never repeats it.
 */
export function claimAnswerText(claim: Pick<SaleClaim, 'state' | 'answerNote'>): string | null {
  switch (claim.state) {
    case 'waiting':
      return 'Un manager regarde les ventes de ce shift.';
    case 'settled':
      return 'La vente apparaît « Reçue de … » sur ton relevé.';
    case 'not_retained':
      return claim.answerNote === null ? null : `Réponse : ${quoted(claim.answerNote)}`;
    case 'withdrawn':
      return null;
  }
}
