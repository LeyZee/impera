import type {
  InvoiceNotIssuedReason,
  MemberSetup,
  PayoutDestinationSummary,
  TeamMemberId,
} from '@impera/contracts';

/*
 * « Avant ton premier versement » (recette PARC-01): every gap that would hold a transfer back, all at once, the
 * agency's first and then member by member, as the server reads them now. Nothing here decides a gap: the server gives
 * each paid member's reasons (`billing` step of « Mise en route »), and the owner's list says whose « Où te verser » is
 * empty. Read by the owner alone.
 */

/** What only the agency settles, in Réglages › Facturation: said once, never under each member. */
const AGENCY_GAPS: readonly InvoiceNotIssuedReason[] = ['agency_missing', 'mandate_unpublished'];

const AGENCY_WORDS: Readonly<Partial<Record<InvoiceNotIssuedReason, string>>> = {
  agency_missing: 'L’identité de l’agence n’est pas remplie',
  mandate_unpublished: 'Le mandat de facturation n’est pas publié',
};

/** A member's gap, short, under his name; who does it is said when it is not the owner. */
const MEMBER_WORDS: Readonly<Record<InvoiceNotIssuedReason, string | null>> = {
  // The agency's, said once above the members.
  agency_missing: null,
  mandate_unpublished: null,
  no_mandate: 'Mandat de facturation pas encore accepté (par lui, dans Moi › Dossier)',
  no_regime: 'Aucun régime de facturation donné',
  regime_not_validated: 'Régime en attente du comptable',
  regime_country_mismatch: 'Régime d’un autre pays que celui de sa fiche',
  identity_incomplete: 'Identité incomplète (par lui, dans Moi › Dossier)',
  identity_unverified: 'Identité à vérifier par toi',
  tax_residence_missing: 'Attestation de résidence fiscale absente',
  tax_residence_unverified: 'Attestation de résidence fiscale à vérifier par toi',
  prefix_missing: 'Préfixe de factures à poser',
  // A credit note no invoice takes is the accountant's, never a step before a first transfer.
  no_invoice_to_credit: null,
};

export const PAYOUT_MISSING = 'Où lui verser : pas encore rempli (par lui, dans Moi › Dossier)';

export interface MemberGaps {
  readonly memberId: TeamMemberId;
  readonly name: string;
  readonly gaps: readonly string[];
}

export interface FirstPayoutGaps {
  /** The agency's own gaps, each once. */
  readonly agency: readonly string[];
  readonly members: readonly MemberGaps[];
}

const isAgencyGap = (reason: InvoiceNotIssuedReason): boolean => AGENCY_GAPS.includes(reason);

/**
 * Every gap at once. A member is paid when the server gives him a « Facturation » step; his « Où te verser » counts only
 * then, and only once the owner's list is read (`null` while it is not: nothing is said rather than a false gap).
 */
export function firstPayoutGaps(
  setups: readonly MemberSetup[],
  payouts: readonly PayoutDestinationSummary[] | null,
  nameOf: (memberId: TeamMemberId) => string,
): FirstPayoutGaps {
  const agency = new Set<InvoiceNotIssuedReason>();
  const members: MemberGaps[] = [];
  for (const setup of setups) {
    const step = setup.steps.find((one) => one.key === 'billing');
    if (step === undefined) continue;
    const reasons = step.note?.kind === 'billing' ? step.note.reasons : [];
    const gaps: string[] = [];
    for (const reason of reasons) {
      if (isAgencyGap(reason)) agency.add(reason);
      else {
        const words = MEMBER_WORDS[reason];
        if (words !== null) gaps.push(words);
      }
    }
    const payout = payouts?.find((one) => one.memberId === setup.memberId);
    if (payout?.method === null) gaps.push(PAYOUT_MISSING);
    if (gaps.length > 0) members.push({ memberId: setup.memberId, name: nameOf(setup.memberId), gaps });
  }
  return {
    agency: AGENCY_GAPS.filter((reason) => agency.has(reason)).flatMap(
      (reason) => AGENCY_WORDS[reason] ?? [],
    ),
    members,
  };
}

/**
 * The one line « À faire » says under its title (Design, 27/11): the first gap with whose it is, then how many are left
 * for each, so that no gap reads as another's (« L’agence : le mandat … · 2 pour Théo »).
 */
export function firstPayoutSummary(gaps: FirstPayoutGaps): string | null {
  const owned = [
    ...gaps.agency.map((gap) => ({ owner: 'L’agence', gap })),
    ...gaps.members.flatMap((member) => member.gaps.map((gap) => ({ owner: member.name, gap }))),
  ];
  const [first, ...rest] = owned;
  if (first === undefined) return null;
  const counts = new Map<string, number>();
  for (const one of rest) counts.set(one.owner, (counts.get(one.owner) ?? 0) + 1);
  const lead = `${first.owner} : ${first.gap.charAt(0).toLowerCase()}${first.gap.slice(1)}`;
  return [
    lead,
    ...[...counts].map(
      ([owner, count]) => `${String(count)} pour ${owner === 'L’agence' ? 'l’agence' : owner}`,
    ),
  ].join(' · ');
}

/** How many things are left, the agency's and every member's. */
export const gapCount = (gaps: FirstPayoutGaps): number =>
  gaps.agency.length + gaps.members.reduce((sum, member) => sum + member.gaps.length, 0);
