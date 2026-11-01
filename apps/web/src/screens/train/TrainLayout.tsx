import { Outlet, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Page, PageHeader, SubNav, type SubNavItem } from '@/shell/layout';

/**
 * The screens of Entraîner that exist. ADR 0024: a tab appears only once its screen exists, never empty nor
 * greyed. Corrections and Tests come back here with their screens.
 */
const TRAIN_TABS: readonly SubNavItem[] = [{ to: '/entrainer/playground', label: 'Playground' }];

export function TrainLayout(): JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // The Playground scrolls its thread inside and keeps the composer in view: its page fills the stage.
  return (
    <Page className={pathname.startsWith('/entrainer/playground') ? 'nv-page--fill' : undefined}>
      <PageHeader
        title="Entraîner"
        lead="Parle à la persona comme un fan, avant qu’un vrai fan ne la lise : rien n’est envoyé."
        // One screen is no choice: no tab bar until there is a second one.
        {...(TRAIN_TABS.length > 1 && { actions: <SubNav label="Entraîner" items={TRAIN_TABS} /> })}
      />
      <Outlet />
    </Page>
  );
}
