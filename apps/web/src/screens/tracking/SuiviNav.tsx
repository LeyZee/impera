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

/** Who reads every fan of a creator (ADR 0124 § 4): the owner and an active manager, as the server serves the list. */
export function readsFans(me: { readonly role: string; readonly teamScope: string }): boolean {
  return me.role === 'owner' || me.teamScope === 'agency';
}

/**
 * Suivi's views (ADR 0024, P4-01, ADR 0134 § 5): the conversations, every fan of a creator for those who read them,
 * and the alerts, sub-views and no new tab of the rail. Without a count: the alerts are no inbox, what asks for a hand
 * is in « À traiter ».
 */
export function SuiviNav({ fans }: { fans: boolean }): JSX.Element {
  return (
    <SubNav
      label="Suivi"
      items={[
        { to: '/suivi', label: screenLabel('/suivi') },
        ...(fans ? [{ to: '/suivi/fans' as const, label: screenLabel('/suivi/fans') }] : []),
        { to: '/suivi/alertes', label: screenLabel('/suivi/alertes') },
      ]}
    />
  );
}
