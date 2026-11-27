import { Link, useCanGoBack, useRouteContext, useRouter, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';

import { offRailSectionOf, railOf, sectionLabel } from './nav';

/**
 * The way back from a page outside the rail (Notifications, the guides), in the header's eyebrow like « ← Créatrices »:
 * to Moi › Préférences, which links to them, for an account whose rail holds Moi; to the page he came from for the
 * extension's guide, reached from Aujourd'hui, the welcome or Sécurité (recette navigation du 27/11, CH-05), Moi ›
 * Sécurité when he opened it first; to Réglages for the owner's guides,
 * the tab they light (recette visuelle 16/11, T9); to the account's first tab otherwise. An app installed on a phone has
 * no « Précédent » of the browser (recette 11/11, CHA-26, CRE-28).
 */
const EXTENSION_PAGES: ReadonlySet<string> = new Set(['/aide/extension', '/extension/lier']);

export function OffRailBack(): JSX.Element | null {
  // Not strict: the page may be drawn outside the app's router context (its own tests); then it has no way back to give.
  const user = useRouteContext({ strict: false, select: (context) => context.user });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (user === undefined) return null;
  const rail = railOf(user);
  const lit = offRailSectionOf(pathname, rail);
  const extensionPage = EXTENSION_PAGES.has(pathname.replace(/\/+$/u, ''));
  // The extension's guide is reached from three places: back to the one he came from (recette du 27/11, CH-05).
  if (extensionPage && canGoBack) {
    return (
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back"
        onClick={() => {
          router.history.back();
        }}
      >
        ← Retour
      </button>
    );
  }
  // Opened first: Moi › Sécurité, where the extension is linked (recette CHAT-08).
  if (lit === '/moi' && extensionPage) {
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
