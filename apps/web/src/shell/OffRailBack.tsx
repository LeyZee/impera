import { Link, useRouteContext } from '@tanstack/react-router';
import type { JSX } from 'react';

import { canOpen, railOf, sectionLabel } from './nav';

/**
 * The way back from a page outside the rail (Notifications, Installer Impera, Installer l'extension), in the header's
 * eyebrow like « ← Créatrices »: to Moi › Préférences, which links to them, for an account whose rail holds Moi; to the
 * account's first tab otherwise (the owner's menu opens them). An app installed on a phone has no « Précédent » of the
 * browser (recette 11/11, CHA-26, CRE-28).
 */
export function OffRailBack(): JSX.Element | null {
  // Not strict: the page may be drawn outside the app's router context (its own tests); then it has no way back to give.
  const user = useRouteContext({ strict: false, select: (context) => context.user });
  if (user === undefined) return null;
  const rail = railOf(user);
  if (canOpen(rail, '/moi')) {
    return (
      <Link to="/moi/preferences" className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
        ← Moi › Préférences
      </Link>
    );
  }
  return (
    <Link to={rail.home} className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
      ← {sectionLabel(rail.home)}
    </Link>
  );
}
