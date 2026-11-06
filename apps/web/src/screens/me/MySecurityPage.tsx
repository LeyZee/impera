import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { SecuritySection } from '@/security/SecuritySection';
import { PrivateChat } from '@/settings/telegram/PrivateChat';
import { Page, Panel, PanelSection, PageHeader } from '@/shell/layout';

/**
 * Moi › Sécurité (SEC-04, ADR 0046 § 7): a chatter's, a manager's and a creator's own sessions and backup codes, what
 * the owner finds in Réglages › Sécurité. A chatter's or a manager's private chat with the agency's bot sits under them
 * (SEC-05 lot 2, ADR 0068 § 5): Réglages, where the owner links his, is not theirs; a creator keeps her own way back.
 */
export function MySecurityPage({ user }: { user: Me }): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Sécurité"
        lead={
          user.role === 'creator'
            ? 'Les appareils où ton compte est ouvert, et tes codes de secours.'
            : 'Les appareils où ton compte est ouvert, tes codes de secours et ton chat Telegram.'
        }
        actions={<MeNav manager={user.teamScope === 'agency'} creator={user.role === 'creator'} />}
      />
      <div className="flex flex-col gap-4">
        <SecuritySection />
        {user.role === 'creator' ? null : (
          <PrivateChat
            owner={false}
            frame={(body) => (
              <Panel title="Mon chat privé" eyebrow="Telegram">
                <PanelSection>{body}</PanelSection>
              </Panel>
            )}
          />
        )}
      </div>
    </Page>
  );
}
