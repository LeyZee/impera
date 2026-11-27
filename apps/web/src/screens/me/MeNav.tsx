import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

/**
 * Moi's screens (ADR 0024, EQ-06 lot 8b, SEC-04): « Profil » first, who he is in the team (CHAT-30), « Dossier », for a manager « Factures », his own documents, which a
 * chatter reads in Commissions, and for everyone « Sécurité », his sessions and backup codes (ADR 0046 § 7). A
 * creator's Moi holds her « Profil » first (CRE-03), her « Persona », « Mes liens » (INS-03), her « Trophées » (ADR 0108) and her « Sécurité » (ADR 0042 § 8): no file, no calendar of shifts. Everyone's ends
 * with « Aide », the person's guide (21/11), then « Préférences »: the appearance, the notifications, the way out (D-03).
 */
export function MeNav({
  manager = false,
  creator = false,
  trophies = false,
}: {
  manager?: boolean;
  creator?: boolean;
  /**
   * « Trophées » for one who plays the chatter's game, on the same rule as its route (`playsTheGame`): never for a
   * manager, on leave or not (recette 16/11, CHT-05). A creator's Moi always has hers.
   */
  trophies?: boolean;
}): JSX.Element {
  const screens: readonly ScreenPath[] = creator
    ? [
        '/moi/profil',
        '/moi/persona',
        '/moi/liens',
        '/moi/trophees',
        '/moi/securite',
        '/moi/aide',
        '/moi/preferences',
      ]
    : manager
      ? [
          '/moi/profil',
          '/moi/dossier',
          '/moi/factures',
          '/moi/calendrier',
          '/moi/securite',
          '/moi/aide',
          '/moi/preferences',
        ]
      : [
          '/moi/profil',
          ...(trophies ? (['/moi/trophees'] as const) : []),
          // No « Calendrier » for a chatter: his link is on Planning, « Dans mon téléphone », where his shifts are
          // (ADR 0134, lot 1). A manager has no Planning of his own in his menu and keeps the tab.
          '/moi/dossier',
          '/moi/securite',
          '/moi/aide',
          '/moi/preferences',
        ];
  return <SubNav label="Moi" items={screens.map((to) => ({ to, label: screenLabel(to) }))} />;
}
