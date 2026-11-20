import { Link, useRouteContext, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, type JSX } from 'react';

import { NavIcon } from './NavIcon';
import { Page, PageHeader, Panel } from './layout';
import { railOf, sectionLabel } from './nav';

import { reportError } from '@/lib/error-reports';

/**
 * A screen that could not draw itself (a broken link, a fault of ours): said in French and plainly, with the way back
 * to the account's first tab, in place of the router's « Something went wrong! » in English (recette CHT-06). The
 * same card as « Page introuvable ». The error is told to the API, which forwards it to Sentry (OPS-18).
 */
export function ErrorPage({ error }: ErrorComponentProps): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  useEffect(() => {
    reportError(error, router.state.matches.at(-1)?.fullPath);
  }, [error, router]);
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
