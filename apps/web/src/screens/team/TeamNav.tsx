import type { JSX } from 'react';

import { useReports } from '@/reports/api';
import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * Équipe's screens (ADR 0024 : Planning, Rapports, Membres, Annonces), those that exist today. Rapports carries the
 * count of reports the reader may validate now, in a quiet tone: waiting reports are no emergency (EQ-04).
 */
export function TeamNav(): JSX.Element {
  const open = useReports(null);
  const toValidate = (open.data?.reports ?? []).filter(
    (one) => one.status === 'submitted' && one.canReview,
  ).length;
  return (
    <SubNav
      label="Équipe"
      items={[
        { to: '/equipe/planning', label: screenLabel('/equipe/planning') },
        {
          to: '/equipe/rapports',
          label: screenLabel('/equipe/rapports'),
          ...(toValidate === 0 ? {} : { count: toValidate }),
        },
        { to: '/equipe/membres', label: screenLabel('/equipe/membres') },
      ]}
    />
  );
}
