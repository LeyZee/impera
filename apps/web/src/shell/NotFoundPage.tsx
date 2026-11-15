import { Link, useRouteContext } from '@tanstack/react-router';
import type { JSX } from 'react';

import { NavIcon } from './NavIcon';
import { Page, PageHeader, Panel } from './layout';
import { railOf, sectionLabel } from './nav';

/**
 * An address that leads nowhere (a link mistyped, a screen moved): said plainly, with the way back to the account's
 * first tab. A card the height of what it says, under a compass: a card stretched over the whole screen read as a page
 * left unfinished (recette 11/11, CRE-35).
 */
export function NotFoundPage(): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const rail = railOf(user);
  const home = rail.home;
  return (
    <Page>
      <PageHeader title="Page introuvable" />
      <Panel className="nv-coming nv-notfound">
        <div className="nv-coming__in">
          <span className="nv-notfound__icon" aria-hidden="true">
            <NavIcon name="compass" />
          </span>
          <h2>Cette page n’existe pas</h2>
          <p className="nv-notfound__text">
            L’adresse est peut-être mal écrite, ou la page a changé de place.
          </p>
          <Link to={home} className="nv-btn nv-btn--soft nv-btn--sm nv-notfound__back">
            Revenir à {sectionLabel(home)}
          </Link>
        </div>
      </Panel>
    </Page>
  );
}
