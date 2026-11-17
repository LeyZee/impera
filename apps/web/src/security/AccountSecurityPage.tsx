import type { JSX } from 'react';

import { SecuritySection } from './SecuritySection';

import { OffRailBack } from '@/shell/OffRailBack';
import { Page, PageHeader } from '@/shell/layout';

/**
 * The account's security outside the rail (SEC-04): an operator has neither Réglages nor Moi, and finds his own
 * sessions and backup codes here, from the account's menu, with a way back to his first tab (recette visuelle 16/11,
 * T9). Every other account is led to its own section's page by the route.
 */
export function AccountSecurityPage(): JSX.Element {
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={<OffRailBack />}
        title="Sécurité"
        lead="Les appareils où ton compte est ouvert, et tes codes de secours."
      />
      <SecuritySection />
    </Page>
  );
}
