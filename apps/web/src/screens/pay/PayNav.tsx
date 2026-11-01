import type { JSX } from 'react';

import { useValidateCount } from './data';

import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * Paie's screens (ADR 0024 : Quinzaine, Historique, Primes et malus, Objectifs), those that exist today. Quinzaine carries
 * the count of statements the reader may validate now, and none while something blocks the period.
 */
export function PayNav(): JSX.Element {
  const count = useValidateCount();
  return (
    <SubNav
      label="Paie"
      items={[
        { to: '/paie/quinzaine', label: screenLabel('/paie/quinzaine'), ...(count === 0 ? {} : { count }) },
        { to: '/paie/releves', label: screenLabel('/paie/releves') },
        { to: '/paie/primes-malus', label: screenLabel('/paie/primes-malus') },
        { to: '/paie/objectifs', label: screenLabel('/paie/objectifs') },
      ]}
    />
  );
}
