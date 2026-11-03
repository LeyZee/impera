import type { JSX } from 'react';

import { SubNav } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

/**
 * Moi's screens (ADR 0024, EQ-06 lot 8b, SEC-04): « Dossier », for a manager « Factures », his own documents, which a
 * chatter reads in Commissions, and for everyone « Sécurité », his sessions and backup codes (ADR 0046 § 7). A
 * creator's Moi holds her « Persona » and her « Sécurité » (ADR 0042 § 8): no file, no calendar of shifts.
 */
export function MeNav({
  manager = false,
  creator = false,
}: {
  manager?: boolean;
  creator?: boolean;
}): JSX.Element {
  const screens: readonly ScreenPath[] = creator
    ? ['/moi/persona', '/moi/securite']
    : manager
      ? ['/moi/dossier', '/moi/factures', '/moi/calendrier', '/moi/securite']
      : ['/moi/dossier', '/moi/calendrier', '/moi/securite'];
  return <SubNav label="Moi" items={screens.map((to) => ({ to, label: screenLabel(to) }))} />;
}
