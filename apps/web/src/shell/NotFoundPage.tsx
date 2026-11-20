import { Link, useRouteContext } from '@tanstack/react-router';
import type { JSX } from 'react';

import { CompassArt } from './art/EmptyArt';
import { Page, PageHeader } from './layout';
import { railOf, sectionLabel } from './nav';
import { Empty } from './states';

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
      <Empty
        plate
        className="nv-notfound"
        art={<CompassArt />}
        title="Cette page n’existe pas"
        action={
          <Link to={home} className="nv-btn nv-btn--soft">
            Revenir à {sectionLabel(home)}
          </Link>
        }
      >
        L’adresse est peut-être mal écrite, ou la page a changé de place.
      </Empty>
    </Page>
  );
}
