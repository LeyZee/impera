import type { Me, PayPeriod } from '@impera/contracts';
import type { JSX } from 'react';

import { useValidateCount } from './data';

import { SubNav, type SubNavItem } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

type PayPath = Extract<ScreenPath, `/paie/${string}`>;

/**
 * Paie's screens (ADR 0024 : Quinzaine, Relevés, Primes et malus, Objectifs, Factures, Exports). Quinzaine carries
 * the count of statements the reader may validate now, and none while something blocks the period. Exports is the
 * owner's alone (EQ-06 lot 8c): a manager has no tab, and its address sends him to Paie.
 * The period on screen goes with every tab (recette visuelle 16/11, GES-02): the next tab opens on the same quinzaine,
 * the screens without one (Relevés, Exports) keeping it in their address for the way back.
 */
export function PayNav({ user, period }: { user: Me; period: PayPeriod | null }): JSX.Element {
  const count = useValidateCount();
  const tab = (to: PayPath): SubNavItem => ({
    to,
    label: screenLabel(to),
    ...(period === null ? {} : { search: { quinzaine: period } }),
  });
  return (
    <SubNav
      label="Paie"
      items={[
        { ...tab('/paie/quinzaine'), ...(count === 0 ? {} : { count }) },
        tab('/paie/releves'),
        tab('/paie/primes-malus'),
        tab('/paie/objectifs'),
        tab('/paie/factures'),
        ...(user.role === 'owner' ? [tab('/paie/exports')] : []),
      ]}
    />
  );
}
