import type { JSX } from 'react';

import { useReports } from '@/reports/api';
import { awaitsDecision, toDecideText } from '@/reports/model';
import { useNow } from '@/scheduling/useNow';
import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * Équipe's screens (ADR 0024 : Planning, Rapports, Membres, Annonces), those that exist today. Rapports carries the
 * count of reports the reader decides now, in a quiet tone: waiting reports are no emergency (EQ-04). A gap still
 * waiting for its member and a report the automatic check validates are not theirs yet (ADR 0073).
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
      ]}
    />
  );
}
