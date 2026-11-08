import type { JSX } from 'react';

import { newcomersLine, removalsLine, toTreat } from './reveal';

import { useReports } from '@/reports/api';
import { awaitsDecision, toDecideText } from '@/reports/model';
import { useNow } from '@/scheduling/useNow';
import { useTeamImportCounts } from '@/settings/sales-feed/api';
import { SubNav, type SubNavItem } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * Équipe's screens (ADR 0024 : Planning, Rapports, Membres, Annonces), those that exist today, and Reveal's team for
 * the owner and an active manager (ADR 0076). Rapports carries the count of reports the reader decides now, in a quiet
 * tone: waiting reports are no emergency (EQ-04). A gap still waiting for its member and a report the automatic check
 * validates are not theirs yet (ADR 0073). Reveal carries its newcomers and its removals (ADR 0076 § 5, § 6).
 */
export function TeamNav({
  inMember = false,
}: {
  /** On a screen of one member (his file): « Membres » stays lit, its address being his list's. */
  inMember?: boolean;
} = {}): JSX.Element {
  const open = useReports(null);
  const now = useNow();
  const toValidate = (open.data?.reports ?? []).filter((one) => awaitsDecision(one, now)).length;
  // Reveal's team (ADR 0076): a tab for the owner and an active manager only, the others read a 403 and see none.
  const reveal = useTeamImportCounts('reveal').data;
  const revealCount = reveal === undefined ? 0 : toTreat(reveal);
  const revealTab: SubNavItem | null =
    reveal === undefined
      ? null
      : {
          to: '/equipe/reveal',
          label: screenLabel('/equipe/reveal'),
          ...(revealCount === 0
            ? {}
            : {
                count: revealCount,
                countLabel: [
                  reveal.newCount === 0 ? null : newcomersLine(reveal.newCount, 'Reveal'),
                  reveal.removalCount === 0 ? null : removalsLine(reveal.removalCount, 'Reveal'),
                ]
                  .filter((line) => line !== null)
                  .join(' · '),
              }),
        };
  return (
    <SubNav
      label="Équipe"
      items={[
        { to: '/equipe/planning', label: screenLabel('/equipe/planning') },
        {
          to: '/equipe/rapports',
          label: screenLabel('/equipe/rapports'),
          ...(toValidate === 0 ? {} : { count: toValidate, countLabel: toDecideText(toValidate) }),
        },
        {
          to: '/equipe/membres',
          label: screenLabel('/equipe/membres'),
          ...(inMember ? { current: true } : {}),
        },
        ...(revealTab === null ? [] : [revealTab]),
      ]}
    />
  );
}
