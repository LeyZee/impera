import type { Me } from '@nirvana/contracts';
import type { JSX } from 'react';

import { useValidateCount } from './data';

import { SubNav, type SubNavItem } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

const EXPORTS: SubNavItem = { to: '/paie/exports', label: screenLabel('/paie/exports') };

/**
 * Paie's screens (ADR 0024 : Quinzaine, Historique, Primes et malus, Objectifs, Factures, Exports). Quinzaine carries
 * the count of statements the reader may validate now, and none while something blocks the period. Exports is the
 * owner's alone (EQ-06 lot 8c): a manager has no tab, and its address sends him to Paie.
 */
export function PayNav({ user }: { user: Me }): JSX.Element {
  const count = useValidateCount();
  return (
    <SubNav
      label="Paie"
      items={[
        { to: '/paie/quinzaine', label: screenLabel('/paie/quinzaine'), ...(count === 0 ? {} : { count }) },
        { to: '/paie/releves', label: screenLabel('/paie/releves') },
        { to: '/paie/primes-malus', label: screenLabel('/paie/primes-malus') },
        { to: '/paie/objectifs', label: screenLabel('/paie/objectifs') },
        { to: '/paie/factures', label: screenLabel('/paie/factures') },
        ...(user.role === 'owner' ? [EXPORTS] : []),
      ]}
    />
  );
}
