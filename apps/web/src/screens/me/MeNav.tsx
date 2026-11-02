import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * Moi's screens (ADR 0024, EQ-06 lot 8b): « Dossier », and for a manager « Factures », his own documents, which a
 * chatter reads in Commissions. A chatter's Moi holds one screen: no sub-tabs then.
 */
export function MeNav(): JSX.Element {
  return (
    <SubNav
      label="Moi"
      items={[
        { to: '/moi/dossier', label: screenLabel('/moi/dossier') },
        { to: '/moi/factures', label: screenLabel('/moi/factures') },
      ]}
    />
  );
}
