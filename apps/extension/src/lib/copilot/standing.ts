import type { DesireBand, FanFlags, RejectReason } from '@impera/contracts';

/**
 * « Où on en est », in one line on top of the panel (ADR 0086 § 3.1): in red what forbids the sale, in amber what holds
 * it back, then his desire in words. The words are the CRM's own (Suivi, CHAT-23), said shorter: the panel is narrow.
 */

export interface Standing {
  /** Red: no offer at all (§ 10, red is kept for these). */
  readonly stops: readonly string[];
  /** Amber: it changes how one writes. */
  readonly cares: readonly string[];
  readonly band: DesireBand | null;
  /** His limits could not be read: said in amber, never as nothing to say. */
  readonly unread: boolean;
  /**
   * « Ne plus lui écrire »: nothing at all goes to him, so the panel offers no text to copy (recette du 16/11, EXT-05).
   * The other stops forbid an offer, not a word: their draft stays his to read and to send.
   */
  readonly noContact: boolean;
}

/**
 * Why the panel offers no text to copy, or null when it may. Closed by default: limits that could not be read, or not
 * read yet, may hide « Ne plus lui écrire », so nothing is offered until they are (relecture de Bilan, PR du panneau).
 */
export type Withheld = 'no_contact' | 'unread';

export function withheldOf(standing: Standing | null): Withheld | null {
  if (standing === null || standing.unread) return 'unread';
  return standing.noContact ? 'no_contact' : null;
}

export const DESIRE_WORDS: Readonly<Record<DesireBand, string>> = {
  neutral: 'neutre',
  playful: 'joueur',
  hot: 'chaud',
};

const euros = (minor: number): string =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.floor(minor / 100));

export function standingOf(flags: FanFlags | 'unread', band: DesireBand | null): Standing {
  if (flags === 'unread') return { stops: [], cares: [], band, unread: true, noContact: false };
  const stops: string[] = [];
  const cares: string[] = [];
  if (flags.doNotContact !== undefined) stops.push('Ne plus lui écrire');
  if (flags.salesFrozen !== undefined) stops.push('Ventes gelées');
  if (flags.ageDisputed !== undefined) stops.push('Âge contesté');
  if (flags.fragile !== undefined) cares.push('Fan fragile');
  if (flags.noExplicit !== undefined) cares.push('Rien d’explicite');
  if (flags.spendingLimitMinor !== undefined) cares.push(`Plafond ${euros(flags.spendingLimitMinor)}\u00a0€`);
  return { stops, cares, band, unread: false, noContact: flags.doNotContact !== undefined };
}

/** The playground's closed list (ADR 0086 § 4), in the server's words (calibration.ts). */
export const REJECT_WORDS: Readonly<Record<RejectReason, string>> = {
  sounds_ai: 'Sonne IA',
  out_of_character: 'Hors personnage',
  too_long: 'Trop long',
  too_early_sexual: 'Trop tôt sexuel',
  missed_sale: 'Vente ratée',
  forgot_fact: 'A oublié un fait',
  other: 'Autre',
};
