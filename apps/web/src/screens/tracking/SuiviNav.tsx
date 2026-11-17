import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel } from '@/shell/nav';

/**
 * The eyebrow of Suivi's screens: the section, then the creator when the reader follows only one (« Suivi · Léa »),
 * the same on both tabs (recette visuelle 16/11, COH-01).
 */
export function suiviEyebrow(creatorName: string | undefined): string {
  return creatorName === undefined ? 'Suivi' : `Suivi · ${creatorName}`;
}

/**
 * Suivi's views (ADR 0024, P4-01): the conversations, and the history of the alerts beside them, a sub-view and no new
 * tab of the rail. Without a count: the history is no inbox, what asks for a hand is in « À traiter ».
 */
export function SuiviNav(): JSX.Element {
  return (
    <SubNav
      label="Suivi"
      items={[
        { to: '/suivi', label: screenLabel('/suivi') },
        { to: '/suivi/alertes', label: screenLabel('/suivi/alertes') },
      ]}
    />
  );
}
