import { Link, useRouteContext } from '@tanstack/react-router';
import type { JSX } from 'react';

import { NavIcon } from './NavIcon';
import { Page, PageHeader, Panel } from './layout';
import { railOf, sectionLabel } from './nav';

/**
 * A screen that could not draw itself (a broken link, a fault of ours): said in French and plainly, with the way back
 * to the account's first tab, in place of the router's « Something went wrong! » in English (recette CHT-06). The
 * same card as « Page introuvable ».
 */
export function ErrorPage(): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const home = railOf(user).home;
  return (
    <Page>
      <PageHeader title="Un souci d’affichage" />
      <Panel className="nv-coming nv-notfound">
        <div className="nv-coming__in">
          <span className="nv-notfound__icon" aria-hidden="true">
            <NavIcon name="compass" />
          </span>
          <h2 className="nv-h2">Cette page n’a pas pu s’afficher</h2>
          <p className="nv-notfound__text">
            Le lien est peut-être abîmé. Recharge la page, ou repars de {sectionLabel(home)}.
          </p>
          <Link to={home} className="nv-btn nv-btn--soft nv-btn--sm nv-notfound__back">
            Revenir à {sectionLabel(home)}
          </Link>
        </div>
      </Panel>
    </Page>
  );
}
