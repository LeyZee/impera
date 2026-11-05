import type { Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { AppearanceChoice } from '@/shell/AppearanceChoice';
import { NavIcon } from '@/shell/NavIcon';
import { Page, PageHeader, Panel } from '@/shell/layout';
import './me.css';

/**
 * Moi › Préférences (D-03): what « Plus » held on the phone for a rail whose tabs all fit on the bar, the appearance of
 * this browser, what rings on this device, and the way out. The bar keeps its tabs only; nothing lives twice.
 */
export function MyPreferencesPage({ user, onSignOut }: { user: Me; onSignOut: () => void }): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Préférences"
        actions={<MeNav manager={user.teamScope === 'agency'} creator={user.role === 'creator'} />}
      />
      <div className="me-prefs">
        <Panel className="nv-enter" eyebrow="Ce navigateur" title="Apparence">
          <div className="me-prefs__body">
            <AppearanceChoice />
          </div>
        </Panel>
        <Panel className="nv-enter" eyebrow="Cet appareil" title="Notifications">
          <div className="me-prefs__body">
            <p className="me-prefs__text">Ce qui sonne, et les heures où ça se tait.</p>
            <Link to="/notifications" className="nv-btn nv-btn--soft nv-btn--sm me-prefs__go">
              <NavIcon name="bell" />
              Régler mes notifications
            </Link>
          </div>
        </Panel>
        <Panel className="nv-enter" eyebrow={user.name} title="Compte">
          <div className="me-prefs__body">
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm me-prefs__go" onClick={onSignOut}>
              Se déconnecter
            </button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
