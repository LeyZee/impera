import { Link, useRouteContext } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Page, PageHeader, Panel } from './layout';
import { railOf, sectionLabel } from './nav';

/**
 * An address that leads nowhere (a link mistyped, a screen moved): said plainly, with the way back to the account's
 * first tab.
 */
export function NotFoundPage(): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const rail = railOf(user);
  const home = rail.home;
  return (
    <Page>
      <PageHeader title="Page introuvable" />
      <Panel className="nv-coming">
        <div className="nv-coming__in">
          <h2>Cette page n’existe pas</h2>
          <p>L’adresse est peut-être mal écrite, ou la page a changé de place.</p>
          <Link to={home} className="nv-btn nv-btn--soft nv-btn--sm">
            Revenir à {sectionLabel(home, rail.kind)}
          </Link>
        </div>
      </Panel>
    </Page>
  );
}
