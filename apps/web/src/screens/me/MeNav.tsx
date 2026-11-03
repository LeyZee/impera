import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

/**
 * Moi's screens (ADR 0024, EQ-06 lot 8b, SEC-04): « Dossier », for a manager « Factures », his own documents, which a
 * chatter reads in Commissions, and for everyone « Sécurité », his sessions and backup codes (ADR 0046 § 7).
 */
export function MeNav({ manager }: { manager: boolean }): JSX.Element {
  const screens: readonly ScreenPath[] = manager
    ? ['/moi/dossier', '/moi/factures', '/moi/agenda', '/moi/securite']
    : ['/moi/dossier', '/moi/agenda', '/moi/securite'];
  return <SubNav label="Moi" items={screens.map((to) => ({ to, label: screenLabel(to) }))} />;
}
