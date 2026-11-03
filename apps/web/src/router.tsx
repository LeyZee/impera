import type { Me } from '@nirvana/contracts';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';

import { CreatorsPage } from './creators/CreatorsPage';
import { creatorsSearch, parseCreatorsSearch } from './creators/search';
import { parsePaySearch } from './payroll/model';
import { InstallPage } from './pwa/InstallPage';
import { NotificationsPage } from './pwa/NotificationsPage';
import { parseCalendarSearch } from './scheduling/calendar';
import { DashboardPage } from './screens/dashboard/DashboardPage';
import { dashboardSearch, parseDashboardSearch, periodOf } from './screens/dashboard/logic';
import { MyCalendarLinkPage } from './screens/me/MyCalendarLinkPage';
import { MyFilePage } from './screens/me/MyFilePage';
import { MyOwnInvoicesPage } from './screens/me/MyOwnInvoicesPage';
import { MySecurityPage } from './screens/me/MySecurityPage';
import { CommissionsPage } from './screens/pay/CommissionsPage';
import { EntriesPage } from './screens/pay/EntriesPage';
import { ExportsPage } from './screens/pay/ExportsPage';
import { GoalsPage } from './screens/pay/GoalsPage';
import { InvoicesPage } from './screens/pay/InvoicesPage';
import { MyInvoicesPage } from './screens/pay/MyInvoicesPage';
import { PeriodPage } from './screens/pay/PeriodPage';
import { PeriodsPage } from './screens/pay/PeriodsPage';
import { MyPlanningPage, type MyPlanningSearch } from './screens/planning/MyPlanningPage';
import {
  DevicesPage,
  AgentModePage,
  AiModelsPage,
  AlertsPage,
  BackupsPage,
  BillingPage,
  PayRulesPage,
  SalesFeedPage,
  SecurityPage,
  SettingsLayout,
  TelegramPage,
} from './screens/settings/SettingsLayout';
import { MemberFilePage } from './screens/team/MemberFilePage';
import { MembersPage } from './screens/team/MembersPage';
import { PlanningPage } from './screens/team/PlanningPage';
import { ReportsPage } from './screens/team/ReportsPage';
import { parsePlanningSearch, parseReportsSearch, parseTeamSearch } from './screens/team/model';
import { TodayPage } from './screens/today/TodayPage';
import { ChatterTrackingPage } from './screens/tracking/ChatterTrackingPage';
import { SuiviNav } from './screens/tracking/SuiviNav';
import { TrackingPage } from './screens/tracking/TrackingPage';
import { AlertHistoryPage } from './screens/tracking/history/AlertHistoryPage';
import { parseTrackingSearch } from './screens/tracking/view';
import { CorrectionsPage } from './screens/train/CorrectionsPage';
import { PlaygroundPage } from './screens/train/PlaygroundPage';
import { TestsPage } from './screens/train/TestsPage';
import { TrainLayout } from './screens/train/TrainLayout';
import { AccountSecurityPage } from './security/AccountSecurityPage';
import { parseTelegramSearch, searchOfTab, tabOfSearch } from './settings/telegram/search';
import { AppShell } from './shell/AppShell';
import { NotFoundPage } from './shell/NotFoundPage';
import { ACCOUNT_SECURITY, canOpen, railOf, sectionOf } from './shell/nav';

/** What every screen can read: who is signed in, and how to sign out. Given by `App` once the session is known. */
export interface RouterContext {
  readonly user: Me;
  readonly onSignOut: () => void;
}

/** What the shell says when the route guard sends someone to the first tab of their rail (NAV-21). */
export const NOT_YOURS = 'Cette page n’est pas dans ton espace.';

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // A section outside the account's rail sends it to its first tab (ADR 0024); the server's 403 stays the barrier.
  beforeLoad: ({ context, location }) => {
    const rail = railOf(context.user);
    const section = sectionOf(location.pathname);
    if (section !== null && !canOpen(rail, section)) {
      // Said once on arrival (NAV-21): a link pasted from someone else's space is not a broken app. The word rides
      // with the redirect, in the history's state: each arrival has its own, even on the address already shown.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: rail.home, replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function Root() {
    const { user, onSignOut } = rootRoute.useRouteContext();
    return <AppShell user={user} onSignOut={onSignOut} />;
  },
});

const dashboard = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseDashboardSearch,
  component: function Dashboard() {
    const { user } = rootRoute.useRouteContext();
    const search = dashboard.useSearch();
    const navigate = dashboard.useNavigate();
    return (
      <DashboardPage
        period={periodOf(search)}
        onPeriod={(next) => void navigate({ search: dashboardSearch(next), replace: true })}
        forCreator={user.role === 'creator'}
        forOwner={user.role === 'owner'}
        opensTracking={canOpen(railOf(user), '/suivi')}
        canAddCreator={canOpen(railOf(user), '/creatrices')}
      />
    );
  },
});
const creators = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creatrices',
  validateSearch: parseCreatorsSearch,
  // Her hours are the owner's alone (P3-14): anyone else lands on the persona, not on a page the server would refuse.
  beforeLoad: ({ context, search }) => {
    if (search.onglet === 'heures' && context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({
        to: '/creatrices',
        search: creatorsSearch('persona', search.creatrice ?? null),
        replace: true,
      });
    }
  },
  component: function Creators() {
    const { onglet, creatrice } = creators.useSearch();
    const navigate = creators.useNavigate();
    const tab = onglet === 'heures' ? 'hours' : 'persona';
    return (
      <CreatorsPage
        tab={tab}
        creatorId={creatrice ?? null}
        onCreator={(id) => void navigate({ search: creatorsSearch(tab, id) })}
      />
    );
  },
});
const tracking = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suivi',
  validateSearch: parseTrackingSearch,
  component: function Tracking() {
    const { conversation, creatrice } = tracking.useSearch();
    const navigate = tracking.useNavigate();
    const { user } = rootRoute.useRouteContext();
    const rail = railOf(user);
    const props = {
      selected: conversation ?? null,
      selectedCreator: creatrice ?? null,
      onSelect: (id: string | null) => void navigate({ search: id === null ? {} : { conversation: id } }),
      canDecide: user.role !== 'creator',
      canAddCreator: canOpen(rail, '/creatrices'),
    };
    // A chatter reads Suivi within his shift (EQ-13): outside it, the page says so.
    return rail.kind === 'chatter' ? (
      <ChatterTrackingPage {...props} />
    ) : (
      <TrackingPage {...props} nav={<SuiviNav />} />
    );
  },
});
/**
 * Suivi › Historique des alertes (P4-01): whoever reads the whole creator, as the server serves it (owner, operator).
 * A creator never opens Suivi (the root sends her home); a chatter is sent to his own Suivi.
 */
const trackingAlerts = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suivi/alertes',
  validateSearch: parseTrackingSearch,
  beforeLoad: ({ context }) => {
    if (railOf(context.user).kind === 'chatter') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/suivi', replace: true });
    }
  },
  component: function TrackingAlerts() {
    const { conversation } = trackingAlerts.useSearch();
    const navigate = trackingAlerts.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <AlertHistoryPage
        selected={conversation ?? null}
        onSelect={(id) => void navigate({ search: id === null ? {} : { conversation: id } })}
        canDecide={user.role !== 'creator'}
        isOwner={user.role === 'owner'}
        nav={<SuiviNav />}
      />
    );
  },
});

const today = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aujourdhui',
  component: function Today() {
    const { user } = rootRoute.useRouteContext();
    return <TodayPage user={user} />;
  },
});
const myPlanning = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planning',
  validateSearch: (search: Record<string, unknown>): MyPlanningSearch => {
    const { semaine } = parsePlanningSearch(search);
    return { ...(semaine === undefined ? {} : { semaine }), ...parseCalendarSearch(search) };
  },
  component: function MyPlanning() {
    const { user } = rootRoute.useRouteContext();
    const search = myPlanning.useSearch();
    const navigate = myPlanning.useNavigate();
    return (
      <MyPlanningPage
        userId={user.id}
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});

const team = createRoute({ getParentRoute: () => rootRoute, path: '/equipe' });
const teamIndex = createRoute({
  getParentRoute: () => team,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/equipe/planning', replace: true });
  },
});
const teamPlanning = createRoute({
  getParentRoute: () => team,
  path: '/planning',
  validateSearch: (search: Record<string, unknown>) => ({
    ...parsePlanningSearch(search),
    ...parseCalendarSearch(search),
  }),
  component: function TeamPlanning() {
    const { semaine, membre, affichage, mois } = teamPlanning.useSearch();
    const navigate = teamPlanning.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <PlanningPage
        userId={user.id}
        week={semaine ?? null}
        member={membre ?? null}
        onWeek={(monday) =>
          void navigate({ search: (before) => ({ ...before, semaine: monday ?? undefined }) })
        }
        onMember={(id) => void navigate({ search: (before) => ({ ...before, membre: id ?? undefined }) })}
        view={{ affichage, mois }}
        onView={(patch) => void navigate({ search: (before) => ({ ...before, ...patch }) })}
      />
    );
  },
});
const teamReports = createRoute({
  getParentRoute: () => team,
  path: '/rapports',
  validateSearch: parseReportsSearch,
  component: function TeamReports() {
    const { quinzaine, membre } = teamReports.useSearch();
    const navigate = teamReports.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <ReportsPage
        owner={user.role === 'owner'}
        period={quinzaine ?? null}
        member={membre ?? null}
        onPeriod={(period) =>
          void navigate({ search: (before) => ({ ...before, quinzaine: period ?? undefined }) })
        }
      />
    );
  },
});
const teamMembers = createRoute({
  getParentRoute: () => team,
  path: '/membres',
  validateSearch: parseTeamSearch,
  component: function Members() {
    const { onglet, membre } = teamMembers.useSearch();
    const navigate = teamMembers.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <MembersPage
        tab={onglet === 'managers' ? 'manager' : 'chatter'}
        selected={membre ?? null}
        canManage={user.role === 'owner'}
        viewerId={user.id}
        onTab={(tab) =>
          void navigate({
            search: (before) => ({ ...before, onglet: tab === 'manager' ? 'managers' : undefined }),
          })
        }
        onSelect={(id) => void navigate({ search: (before) => ({ ...before, membre: id ?? undefined }) })}
      />
    );
  },
});

// A member's file (EQ-06 lot 8b), the owner's alone: anyone else is sent back to the members.
const teamMemberFile = createRoute({
  getParentRoute: () => team,
  path: '/membres/$memberId/dossier',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/equipe/membres', replace: true });
    }
  },
  component: function MemberFile() {
    const { memberId } = teamMemberFile.useParams();
    const { user } = rootRoute.useRouteContext();
    return <MemberFilePage user={user} memberId={memberId} />;
  },
});

const pay = createRoute({ getParentRoute: () => rootRoute, path: '/paie' });
const payIndex = createRoute({
  getParentRoute: () => pay,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/paie/quinzaine', replace: true });
  },
});
const payPeriod = createRoute({
  getParentRoute: () => pay,
  path: '/quinzaine',
  validateSearch: parsePaySearch,
  component: function PayPeriod() {
    const { quinzaine, membre } = payPeriod.useSearch();
    const navigate = payPeriod.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <PeriodPage
        user={user}
        chosen={quinzaine ?? null}
        member={membre ?? null}
        onPeriod={(period) => void navigate({ search: period === null ? {} : { quinzaine: period } })}
      />
    );
  },
});
const payEntries = createRoute({
  getParentRoute: () => pay,
  path: '/primes-malus',
  validateSearch: parsePaySearch,
  component: function PayEntries() {
    const { quinzaine } = payEntries.useSearch();
    const navigate = payEntries.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <EntriesPage
        user={user}
        chosen={quinzaine ?? null}
        onPeriod={(period) => void navigate({ search: period === null ? {} : { quinzaine: period } })}
      />
    );
  },
});
const payGoals = createRoute({
  getParentRoute: () => pay,
  path: '/objectifs',
  validateSearch: parsePaySearch,
  component: function PayGoals() {
    const { quinzaine } = payGoals.useSearch();
    const navigate = payGoals.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <GoalsPage
        user={user}
        chosen={quinzaine ?? null}
        onPeriod={(period) => void navigate({ search: period === null ? {} : { quinzaine: period } })}
      />
    );
  },
});
const payPeriods = createRoute({
  getParentRoute: () => pay,
  path: '/releves',
  component: function PayPeriods() {
    const navigate = payPeriods.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <PeriodsPage
        user={user}
        onOpen={(period) => void navigate({ to: '/paie/quinzaine', search: { quinzaine: period } })}
      />
    );
  },
});

const payInvoices = createRoute({
  getParentRoute: () => pay,
  path: '/factures',
  validateSearch: parsePaySearch,
  component: function PayInvoices() {
    const { quinzaine, membre } = payInvoices.useSearch();
    const navigate = payInvoices.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <InvoicesPage
        user={user}
        chosen={quinzaine ?? null}
        member={membre ?? null}
        onFilter={(filter) => void navigate({ search: filter })}
      />
    );
  },
});

const payExports = createRoute({
  getParentRoute: () => pay,
  path: '/exports',
  // The owner's alone (EQ-06 lot 8c), as the server serves the exports: a manager is sent to Paie, without a tab.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/paie', replace: true });
    }
  },
  component: function PayExports() {
    const { user } = rootRoute.useRouteContext();
    return <ExportsPage user={user} />;
  },
});

// Commissions (EQ-06 lot 8): « Relevés », the page of the period, and « Factures », one's own documents.
const commissions = createRoute({ getParentRoute: () => rootRoute, path: '/commissions' });
const commissionsIndex = createRoute({
  getParentRoute: () => commissions,
  path: '/',
  component: function Commissions() {
    const { user } = rootRoute.useRouteContext();
    return <CommissionsPage user={user} />;
  },
});
const commissionsInvoices = createRoute({
  getParentRoute: () => commissions,
  path: '/factures',
  component: MyInvoicesPage,
});

// Moi (ADR 0024, EQ-06 lot 8b): the file of a chatter and of a manager, and the manager's own invoices, which a
// chatter reads in Commissions.
const me = createRoute({ getParentRoute: () => rootRoute, path: '/moi' });
const meIndex = createRoute({
  getParentRoute: () => me,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/moi/dossier', replace: true });
  },
});
const meFile = createRoute({
  getParentRoute: () => me,
  path: '/dossier',
  component: function MyFile() {
    const { user } = rootRoute.useRouteContext();
    return <MyFilePage user={user} />;
  },
});
const meInvoices = createRoute({
  getParentRoute: () => me,
  path: '/factures',
  // A manager's: a chatter, or a manager on leave with the chatter's rail, reads his in Commissions.
  beforeLoad: ({ context }) => {
    if (context.user.teamScope !== 'agency') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/commissions/factures', replace: true });
    }
  },
  component: function MyOwnInvoices() {
    const { user } = rootRoute.useRouteContext();
    return <MyOwnInvoicesPage user={user} />;
  },
});

const meCalendar = createRoute({
  getParentRoute: () => me,
  path: '/calendrier',
  component: function MyCalendarLink() {
    const { user } = rootRoute.useRouteContext();
    return <MyCalendarLinkPage user={user} />;
  },
});

const meSecurity = createRoute({
  getParentRoute: () => me,
  path: '/securite',
  component: function MySecurity() {
    const { user } = rootRoute.useRouteContext();
    return <MySecurityPage user={user} />;
  },
});

// Outside the rail (SEC-04): an operator's or a creator's own sessions and backup codes, from the account's menu.
const accountSecurity = createRoute({
  getParentRoute: () => rootRoute,
  path: ACCOUNT_SECURITY,
  component: AccountSecurityPage,
});

const train = createRoute({ getParentRoute: () => rootRoute, path: '/entrainer', component: TrainLayout });
const trainIndex = createRoute({
  getParentRoute: () => train,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/entrainer/playground', replace: true });
  },
});
const playground = createRoute({
  getParentRoute: () => train,
  path: '/playground',
  component: PlaygroundPage,
});
const corrections = createRoute({
  getParentRoute: () => train,
  path: '/corrections',
  component: CorrectionsPage,
});
const tests = createRoute({ getParentRoute: () => train, path: '/tests', component: TestsPage });

const settings = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reglages',
  component: SettingsLayout,
});
const settingsIndex = createRoute({
  getParentRoute: () => settings,
  path: '/',
  // Réglages is the owner's alone (the root sends anyone else home): it opens on Modèles IA.
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/reglages/modeles-ia', replace: true });
  },
});
const aiModels = createRoute({
  getParentRoute: () => settings,
  path: '/modeles-ia',
  // The owner's alone, as the server serves the keys: anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: AiModelsPage,
});
const salesFeeds = createRoute({
  getParentRoute: () => settings,
  path: '/ventes',
  // The owner's alone, as the server serves the key and the links (ADR 0050 § 4): anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: SalesFeedPage,
});
const telegram = createRoute({
  getParentRoute: () => settings,
  path: '/telegram',
  // The owner's alone too (fiche P3-07).
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  validateSearch: parseTelegramSearch,
  component: function Telegram() {
    const search = telegram.useSearch();
    const navigate = telegram.useNavigate();
    return (
      <TelegramPage
        tab={tabOfSearch(search)}
        onTab={(tab) => void navigate({ search: searchOfTab(tab), replace: true })}
      />
    );
  },
});
const alerts = createRoute({
  getParentRoute: () => settings,
  path: '/alertes',
  // The owner's alone (P4-01): anyone else is sent to Réglages, not to a page the server would refuse.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: AlertsPage,
});
const devices = createRoute({ getParentRoute: () => settings, path: '/appareils', component: DevicesPage });
const backups = createRoute({
  getParentRoute: () => settings,
  path: '/sauvegardes',
  // The owner's alone (ADR 0028): anyone else is sent to Réglages, not to a page the server would refuse.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: BackupsPage,
});
const payRules = createRoute({
  getParentRoute: () => settings,
  path: '/regles-de-paie',
  // The owner's alone, like the backups: anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: PayRulesPage,
});
const billing = createRoute({
  getParentRoute: () => settings,
  path: '/facturation',
  // The owner's alone (EQ-06), like the pay rules: anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: BillingPage,
});
const settingsSecurity = createRoute({
  getParentRoute: () => settings,
  path: '/securite',
  // The owner's own and the agency's accounts (SEC-04); a chatter or a manager finds his own in Moi › Sécurité.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true });
    }
  },
  component: function Security() {
    const { user } = rootRoute.useRouteContext();
    return <SecurityPage userId={user.id} />;
  },
});
const agentMode = createRoute({ getParentRoute: () => settings, path: '/mode', component: AgentModePage });

/** /aide/installer (CR-01): open to every role, outside the rail (no section, so the guard lets it through). */
const installHelp = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aide/installer',
  component: InstallPage,
});
/** /notifications (CR-01): every role, from the account's menu; this device and the account's quiet hours. */
const notifications = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: NotificationsPage,
});

const routeTree = rootRoute.addChildren([
  installHelp,
  notifications,
  dashboard,
  creators,
  train.addChildren([trainIndex, playground, corrections, tests]),
  tracking,
  trackingAlerts,
  today,
  myPlanning,
  team.addChildren([teamIndex, teamPlanning, teamReports, teamMembers, teamMemberFile]),
  pay.addChildren([payIndex, payPeriod, payPeriods, payEntries, payGoals, payInvoices, payExports]),
  commissions.addChildren([commissionsIndex, commissionsInvoices]),
  me.addChildren([meIndex, meFile, meInvoices, meCalendar, meSecurity]),
  accountSecurity,
  settings.addChildren([
    settingsIndex,
    aiModels,
    salesFeeds,
    alerts,
    telegram,
    payRules,
    billing,
    backups,
    settingsSecurity,
    devices,
    agentMode,
  ]),
]);

const buildRouter = (context: RouterContext, history?: RouterHistory) =>
  createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    // An unknown address keeps the rail and says so in French, in place of the router's « Not Found ».
    defaultNotFoundComponent: NotFoundPage,
    ...(history === undefined ? {} : { history }),
  });

export type AppRouter = ReturnType<typeof buildRouter>;

/** `history` is for tests, which start on an address of their choosing. */
export function createAppRouter(context: RouterContext, history?: RouterHistory): AppRouter {
  return buildRouter(context, history);
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
  interface HistoryState {
    /** A word for the screen a redirect lands on (NAV-21). */
    notice?: string;
  }
}
