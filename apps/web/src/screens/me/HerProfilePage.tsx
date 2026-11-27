import type { Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { MeNav } from './MeNav';
import './me.css';

import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';
import type { ScreenPath } from '@/shell/nav';
import { screenLabel } from '@/shell/nav';

/**
 * Her other screens of Moi, each in one line: what she finds there (recette visuelle 16/11, CRE-03), in the order of
 * the tabs, none left out (recette navigation 27/11, MOD-07: three tabs hide behind the arrow on a phone). Then her
 * notifications, which her phone reaches nowhere else but through Préférences.
 */
const mine = (to: ScreenPath, line: string) => ({ to, label: screenLabel(to), line }) as const;
const HER_SCREENS: readonly {
  readonly to: ScreenPath | '/notifications';
  readonly label: string;
  readonly line: string;
}[] = [
  mine('/moi/persona', 'Ta fiche, telle que l’agence l’a écrite. Une erreur\u00a0? Propose une correction.'),
  mine('/moi/liens', 'Tes liens à coller, chacun avec l’endroit où il va.'),
  mine('/moi/trophees', 'Tes médailles, tes séries, et le prochain trophée.'),
  mine('/moi/securite', 'Les appareils où ton compte est ouvert, et tes codes de secours.'),
  mine('/moi/aide', 'Ce qu’il faut savoir, et les gestes difficiles pas à pas.'),
  mine('/moi/preferences', 'L’apparence, les notifications, et la déconnexion.'),
  {
    to: '/notifications',
    label: 'Notifications',
    line: 'Ce qui t’attend, ce qui sonne sur ton téléphone, et quand ça se tait.',
  },
];

/**
 * Moi › Profil, the creator's (recette visuelle 16/11, CRE-03, decided on 16/11): Moi opens on who she is in Impera,
 * in a few lines, and where the rest of Moi is; her persona, the longest page of the app, is the next tab. Nothing but
 * her account (`/v1/me`), read by every screen: no request of its own.
 */
export function HerProfilePage({ user }: { user: Me }): JSX.Element {
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title="Profil"
        lead="Qui tu es dans Impera, et où trouver le reste."
        tabs={<MeNav creator />}
      />
      <div className="me-profile">
        <Panel className="nv-enter" title={user.name}>
          <dl className="tm-facts me-her__facts">
            <div>
              <dt>Ton compte</dt>
              <dd className="tm-mail">{user.email}</dd>
            </div>
            <div>
              <dt>Dans Impera</dt>
              <dd>Créatrice</dd>
            </div>
          </dl>
        </Panel>
        <Panel className="nv-enter" title="Dans Moi">
          <ul className="me-her__links">
            {HER_SCREENS.map((one) => (
              <li key={one.to}>
                <Link to={one.to} className="me-her__link">
                  <span className="me-her__text">
                    <b>{one.label}</b>
                    <span>{one.line}</span>
                  </span>
                  <span className="me-her__chevron" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
