import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/** Commissions' screens (EQ-06 lot 8): « Relevés », the page of the period, and « Factures », one's documents. */
export function CommissionsNav(): JSX.Element {
  return (
    <SubNav
      label="Commissions"
      items={[
        { to: '/commissions', label: 'Relevés' },
        { to: '/commissions/factures', label: screenLabel('/commissions/factures') },
      ]}
    />
  );
}
