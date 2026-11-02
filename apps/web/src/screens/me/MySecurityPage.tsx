import type { Me } from '@nirvana/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { SecuritySection } from '@/security/SecuritySection';
import { Page, PageHeader } from '@/shell/layout';

/**
 * Moi › Sécurité (SEC-04, ADR 0046 § 7): a chatter's and a manager's own sessions and backup codes, what the owner
 * finds in Réglages › Sécurité.
 */
export function MySecurityPage({ user }: { user: Me }): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Sécurité"
        lead="Les appareils où ton compte est ouvert, et tes codes de secours."
        actions={<MeNav manager={user.teamScope === 'agency'} />}
      />
      <SecuritySection owner={false} userId={user.id} />
    </Page>
  );
}
