import type { JSX } from 'react';

import { SecuritySection } from './SecuritySection';

import { Page, PageHeader } from '@/shell/layout';

/**
 * The account's security outside the rail (SEC-04): an operator or a creator has neither Réglages nor Moi, and finds
 * her own sessions and backup codes here, from the account's menu.
 */
export function AccountSecurityPage(): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Ton compte"
        title="Sécurité"
        lead="Les appareils où ton compte est ouvert, et tes codes de secours."
      />
      <SecuritySection />
    </Page>
  );
}
