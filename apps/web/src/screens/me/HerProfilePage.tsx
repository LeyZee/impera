import type { Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { MeNav } from './MeNav';
import './me.css';

import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';
import type { ScreenPath } from '@/shell/nav';
import { screenLabel } from '@/shell/nav';

/** Her other screens of Moi, each in one line: what she finds there (recette visuelle 16/11, CRE-03). */
const HER_SCREENS: readonly { readonly to: ScreenPath; readonly line: string }[] = [
  {
    to: '/moi/persona',
    line: 'Ta fiche, telle que l’agence l’a écrite. Une erreur\u00a0? Propose une correction.',
  },
  { to: '/moi/trophees', line: 'Tes médailles, tes séries, et le prochain trophée.' },
  { to: '/moi/securite', line: 'Les appareils où ton compte est ouvert, et tes codes de secours.' },
  { to: '/moi/preferences', line: 'L’apparence, les notifications, et la déconnexion.' },
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
                    <b>{screenLabel(one.to)}</b>
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
