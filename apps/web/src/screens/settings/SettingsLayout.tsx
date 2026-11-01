import { Outlet } from '@tanstack/react-router';
import type { JSX } from 'react';

import { AlertsSection } from '@/settings/alerts/AlertsSection';
import { BackupsSection } from '@/settings/backups/BackupsSection';
import { PayRulesSection } from '@/settings/pay/PayRulesSection';
import { ServicesSection } from '@/settings/services/ServicesSection';
import { TelegramSection } from '@/settings/telegram/TelegramSection';
import type { TelegramTab } from '@/settings/telegram/search';
import { ComingSoon, Page, PageHeader, SubNav, type SubNavItem } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

/**
 * Réglages is the owner's alone (NAV-18): every page of it is served to the owner only, and the appearance, which is
 * everyone's, lives in the account's menu (NAV-03). The AI keys and the bots and groups (P3-03, P3-07), the alerts
 * (P4-01), the accounts' pay rules (EQ-03) and the backups (ADR 0028).
 */
const TABS: readonly SubNavItem[] = (
  [
    '/reglages/modeles-ia',
    '/reglages/alertes',
    '/reglages/telegram',
    '/reglages/regles-de-paie',
    '/reglages/sauvegardes',
  ] satisfies readonly ScreenPath[]
).map((to) => ({ to, label: screenLabel(to) }));

export function SettingsLayout(): JSX.Element {
  // « Se déconnecter » lives in the account's menu, on the phone too (NAV-02, NAV-04).
  return (
    <Page>
      <PageHeader
        title="Réglages"
        lead="Ce qui règle le CRM pour toute l’agence."
        actions={<SubNav label="Réglages" items={TABS} />}
      />
      <Outlet />
    </Page>
  );
}

/** Réglages › Modèles IA: the Services page of P3-03, as the Connecteurs thread built it. */
export function AiModelsPage(): JSX.Element {
  return <ServicesSection />;
}

/** Réglages › Alertes: her own alerts and the system's, on each creator (P4-01). */
export function AlertsPage(): JSX.Element {
  return <AlertsSection />;
}

/** Réglages › Telegram: bots, groups and who gets which alert (fiche P3-07), the tab in the address. */
export function TelegramPage({
  tab,
  onTab,
}: {
  tab: TelegramTab;
  onTab: (tab: TelegramTab) => void;
}): JSX.Element {
  return <TelegramSection tab={tab} onTab={onTab} />;
}

/** Réglages › Règles de paie: each account's currency, VAT, platform commission and source of sales (EQ-03). */
export function PayRulesPage(): JSX.Element {
  return <PayRulesSection />;
}

/** Réglages › Sauvegardes: the nightly export and the restore test (EQ-17, ADR 0028). */
export function BackupsPage(): JSX.Element {
  return <BackupsSection />;
}

/*
 * Appareils and Mode de l'agent keep their routes but no tab (ADR 0024, « zéro bruit »): a tab that only says
 * « à venir » reads as a broken feature, and the mode already changes at the top of the Dashboard. Each tab comes
 * back with its screen (Appareils with the extension).
 */
export function DevicesPage(): JSX.Element {
  return (
    <ComingSoon
      title="Les extensions reliées"
      what="Chaque navigateur où l’extension tourne, sa session Reveal et le moyen de le délier."
      when="Avec l’extension"
    />
  );
}

export function AgentModePage(): JSX.Element {
  return (
    <ComingSoon
      title="Copilote ou automatique"
      what="Le mode se change en haut du Dashboard. L’automatique s’ouvre quand le serveur valide le taux en réel et le test à l’aveugle ; le Dashboard dit ce qui manque, chiffres à l’appui."
      when="Après le copilote"
    />
  );
}
