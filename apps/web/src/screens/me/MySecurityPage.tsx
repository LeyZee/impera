import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { playsTheGame } from '@/rewards/api';
import { SecuritySection } from '@/security/SecuritySection';
import { Page, PageHeader } from '@/shell/layout';

/**
 * Moi › Sécurité (SEC-04, ADR 0046 § 7): a chatter's, a manager's and a creator's own sessions and backup codes, what
 * the owner finds in Réglages › Sécurité. A chatter's or a manager's private chat with the agency's bot sits under them
 * (SEC-05 lot 2, ADR 0068 § 5): Réglages, where the owner links his, is not theirs; a creator keeps her own way back.
 */
export function MySecurityPage({ user }: { user: Me }): JSX.Element {
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title="Sécurité"
        lead={
          user.role === 'creator'
            ? 'Les appareils où ton compte est ouvert, et tes codes de secours.'
            : // How one signs in, first: the cards below then read as its parts (CHA-14); then the extension, linked
              // here by the whole team (recette 16/11, EXT-02).
              'Tu te connectes avec ton mot de passe et le code de ton application ; une clé d’accès les remplace d’un geste. Ton extension se relie ici.'
        }
        tabs={
          <MeNav
            manager={user.teamScope === 'agency'}
            creator={user.role === 'creator'}
            trophies={playsTheGame(user)}
          />
        }
      />
      <div className="flex flex-col gap-4">
        {/* The whole team links its extension: its copilot gestures count by it (recette 16/11, EXT-02). The watch is
            the owner's alone (ADR 0024, amendement du 16/11), whose Sécurité is in Réglages. */}
        <SecuritySection extensionLinks={user.role === 'creator' ? 'none' : 'copilot'} />
      </div>
    </Page>
  );
}
