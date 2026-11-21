import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { Fragment, useState, useSyncExternalStore, type JSX } from 'react';

import { SecuritySection } from '@/security/SecuritySection';
import { BudgetSection } from '@/settings/ai-budget/BudgetSection';
import { aiBudgetQueryKey } from '@/settings/ai-budget/api';
import { AiUsageSection } from '@/settings/ai-usage/AiUsageSection';
import { AlertsSection } from '@/settings/alerts/AlertsSection';
import { BackupsSection } from '@/settings/backups/BackupsSection';
import { BillingSection } from '@/settings/billing/BillingSection';
import { LinkServiceCard } from '@/settings/link-service/LinkServiceCard';
import { PayRulesSection } from '@/settings/pay/PayRulesSection';
import { SalesFeedSection } from '@/settings/sales-feed/SalesFeedSection';
import { newModelsQuery } from '@/settings/sales-feed/api';
import { newModelsLabel } from '@/settings/sales-feed/importing';
import { ServicesSection } from '@/settings/services/ServicesSection';
import { TelegramSection } from '@/settings/telegram/TelegramSection';
import type { TelegramTab } from '@/settings/telegram/search';
import { Page, PageHeader } from '@/shell/layout';
import { screenLabel, type ScreenPath } from '@/shell/nav';

import './settings.css';

/** One line of Réglages' list: a section, and what waits behind it. */
interface SettingsItem {
  readonly to: ScreenPath;
  readonly label: string;
  readonly count?: number;
  /** What the count is, for a screen reader and on hover (« 3 nouvelles créatrices sur Reveal »). */
  readonly countLabel?: string;
}

/** A group of Réglages' list: a short title in sentence case, then its sections. */
interface SettingsGroup {
  readonly title: string;
  readonly items: readonly SettingsItem[];
}

const item = (to: ScreenPath): SettingsItem => ({ to, label: screenLabel(to) });

/**
 * Réglages is the owner's alone (NAV-18): every page of it is served to the owner only, and the appearance, which is
 * everyone's, lives in the account's menu (NAV-03). The AI keys, the platforms' sales feeds (CRM-01), the AI spend and
 * credits (ADR 0091), the bots and groups (P3-03, P3-07), the alerts (P4-01), the accounts' pay rules (EQ-03), what
 * each invoice prints (EQ-06), the backups (ADR 0028) and the security of every account (SEC-04).
 * A list, not nine tabs (recette visuelle 16/11, GES-04, decided on 16/11), in the four groups of ADR 0134 § 6:
 * Connexions (Plateformes, Bots Telegram), IA, Argent, Sécurité. The addresses keep their words (`/reglages/ventes`,
 * `/reglages/telegram`): only what the screens are called changed.
 * Every section is the owner's, as the routes guard them: a section a role could not open would not be listed.
 */
const GROUPS: readonly SettingsGroup[] = [
  { title: 'Connexions', items: [item('/reglages/ventes'), item('/reglages/telegram')] },
  { title: 'IA', items: [item('/reglages/modeles-ia'), item('/reglages/consommation-ia')] },
  { title: 'Argent', items: [item('/reglages/regles-de-paie'), item('/reglages/facturation')] },
  {
    title: 'Sécurité',
    items: [item('/reglages/alertes'), item('/reglages/sauvegardes'), item('/reglages/securite')],
  },
];

/** The section Réglages opens on, on a computer: the list's first. */
const FIRST: ScreenPath = '/reglages/ventes';

/** The section open, by the address; `null` on Réglages itself, the list. */
function openItem(pathname: string): SettingsItem | null {
  const path = pathname.replace(/\/+$/u, '');
  return GROUPS.flatMap((group) => group.items).find((one) => one.to === path) ?? null;
}

/** A computer's width, where the list stands beside the section (settings.css folds it under 821 px). */
const WIDE = '(min-width: 821px)';
const wideQuery = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(WIDE) : null);
function subscribeWide(listener: () => void): () => void {
  const list = wideQuery();
  list?.addEventListener('change', listener);
  return () => {
    list?.removeEventListener('change', listener);
  };
}
const useWide = (): boolean =>
  useSyncExternalStore(
    subscribeWide,
    () => wideQuery()?.matches ?? false,
    () => false,
  );

/** Réglages' list: one line per section, a chevron, 44 px to the finger; the open one lit. */
function SettingsList({ groups }: { groups: readonly SettingsGroup[] }): JSX.Element {
  return (
    <nav className="rgl-list" aria-label="Réglages">
      {groups.map((group) => (
        <Fragment key={group.title}>
          <p className="nv-eyebrow rgl-list__group">{group.title}</p>
          <ul className="rgl-list__items">
            {group.items.map((one) => (
              <li key={one.to}>
                <Link
                  to={one.to}
                  className="rgl-list__item"
                  activeOptions={{ exact: true, includeSearch: false }}
                  activeProps={{ 'aria-current': 'page' }}
                >
                  <span className="rgl-list__label">{one.label}</span>
                  {one.count === undefined || one.count === 0 ? null : one.countLabel === undefined ? (
                    <span className="nv-count">{one.count}</span>
                  ) : (
                    <>
                      <span className="nv-count" aria-hidden="true" title={one.countLabel}>
                        {one.count}
                      </span>
                      <span className="sr-only">{`, ${one.countLabel}`}</span>
                    </>
                  )}
                  <span className="rgl-list__chevron" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * Réglages (recette visuelle 16/11, GES-04): on a computer the list on the page's left and the open section on its
 * right; on a phone the list is Réglages' screen, a section opens on its own with a way back to the list. The header
 * keeps the template (COH-01): « Réglages » above, the section's name as the title.
 */
export function SettingsLayout(): JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // A count read in the base: a failure or a wait shows the line bare, never a wrong number.
  const newModels = useQuery(newModelsQuery).data;
  const countLabel = newModels === undefined ? null : newModelsLabel(newModels);
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.map((one) =>
      one.to === '/reglages/ventes' && newModels !== undefined && countLabel !== null
        ? { ...one, count: newModels.total, countLabel }
        : one,
    ),
  }));
  const open = openItem(pathname);
  // « Se déconnecter » lives in the account's menu, on the phone too (NAV-02, NAV-04).
  return (
    <Page className="rgl-page">
      <PageHeader
        {...(open === null
          ? {}
          : {
              eyebrow: (
                <>
                  <span className="rgl-eyebrow">Réglages</span>
                  {/* A phone: the section is a screen of its own, the way back to the list in the eyebrow. */}
                  {/* Exact: a way back to the list, never « page actuelle » on a section under it (NAV-09). */}
                  <Link
                    to="/reglages"
                    activeOptions={{ exact: true }}
                    className="nv-btn nv-btn--plain nv-btn--sm rgl-back"
                  >
                    ← Réglages
                  </Link>
                </>
              ),
            })}
        title={open?.label ?? 'Réglages'}
        lead="Les réglages de toute l’agence."
      />
      <div className="rgl-body" data-open={open === null ? undefined : ''}>
        <SettingsList groups={groups} />
        <div className="rgl-section">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}

/** Réglages itself: the list on a phone; on a computer, where the list stands beside a section, its first one. */
export function SettingsHome(): JSX.Element | null {
  const wide = useWide();
  return wide ? <Navigate to={FIRST} replace /> : null;
}

/** Réglages › Modèles IA: the Services page of P3-03, as the Connecteurs thread built it. */
export function AiModelsPage(): JSX.Element {
  // One server, two reads: when it is silent, the keys' card says it once and the budget's keeps quiet (ETA-05).
  const client = useQueryClient();
  const [down, setDown] = useState(false);
  return (
    <div className="sv-page">
      <ServicesSection
        onDown={setDown}
        onRetry={() => void client.refetchQueries({ queryKey: aiBudgetQueryKey })}
      />
      <BudgetSection quiet={down} />
    </div>
  );
}

/** Réglages › Consommation IA (ADR 0091): what the AI costs, live, and when to recharge its credits. */
export function AiUsagePage(): JSX.Element {
  return <AiUsageSection />;
}

/**
 * Réglages › Plateformes: the key of each platform's sales feed, its webhook and the owner's links (CRM-01), then the
 * key of the redirect service (INS-02).
 */
export function SalesFeedPage(): JSX.Element {
  return (
    <div className="sv-page">
      <SalesFeedSection />
      <LinkServiceCard />
    </div>
  );
}

/** Réglages › Alertes: her own alerts and the system's, on each creator (P4-01). */
export function AlertsPage(): JSX.Element {
  return <AlertsSection />;
}

/** Réglages › Bots Telegram: bots, groups and who gets which alert (fiche P3-07), the tab in the address. */
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

/** Réglages › Facturation: the agency's identity, service, payment terms and logo on each invoice (EQ-06). */
export function BillingPage(): JSX.Element {
  return <BillingSection />;
}

/** Réglages › Sauvegardes: the nightly export and the restore test (EQ-17, ADR 0028). */
export function BackupsPage(): JSX.Element {
  return <BackupsSection />;
}

/** Réglages › Sécurité (SEC-04): the owner's sessions and backup codes, and every account's second factor. */
export function SecurityPage({ userId }: { userId: string }): JSX.Element {
  return <SecuritySection ownerId={userId} extensionLinks="watch" />;
}
