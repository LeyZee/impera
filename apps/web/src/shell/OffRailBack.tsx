import { Link, useRouteContext, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';

import { offRailSectionOf, railOf, sectionLabel } from './nav';

/**
 * The way back from a page outside the rail (Notifications, the guides), in the header's eyebrow like « ← Créatrices »:
 * to Moi › Préférences, which links to them, for an account whose rail holds Moi (Moi › Sécurité from the extension's
 * pages); to Réglages for the owner's guides,
 * the tab they light (recette visuelle 16/11, T9); to the account's first tab otherwise. An app installed on a phone has
 * no « Précédent » of the browser (recette 11/11, CHA-26, CRE-28).
 */
const EXTENSION_PAGES: ReadonlySet<string> = new Set(['/aide/extension', '/extension/lier']);

export function OffRailBack(): JSX.Element | null {
  // Not strict: the page may be drawn outside the app's router context (its own tests); then it has no way back to give.
  const user = useRouteContext({ strict: false, select: (context) => context.user });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (user === undefined) return null;
  const rail = railOf(user);
  const lit = offRailSectionOf(pathname, rail);
  // The extension's guide and its link page go with Moi › Sécurité, where the copilot is linked (recette CHAT-08).
  if (lit === '/moi' && EXTENSION_PAGES.has(pathname.replace(/\/+$/u, ''))) {
    return (
      <Link to="/moi/securite" className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
        ← Moi › Sécurité
      </Link>
    );
  }
  if (lit === '/moi') {
    return (
      <Link to="/moi/preferences" className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
        ← Moi › Préférences
      </Link>
    );
  }
  const to = lit === '/reglages' ? '/reglages' : rail.home;
  return (
    <Link to={to} className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
      ← {sectionLabel(to)}
    </Link>
  );
}
