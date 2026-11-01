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
import { DashboardPage } from './screens/dashboard/DashboardPage';
import { dashboardSearch, parseDashboardSearch, periodOf } from './screens/dashboard/logic';
import { CommissionsPage } from './screens/pay/CommissionsPage';
import { EntriesPage } from './screens/pay/EntriesPage';
import { GoalsPage } from './screens/pay/GoalsPage';
import { PeriodPage } from './screens/pay/PeriodPage';
import { PeriodsPage } from './screens/pay/PeriodsPage';
import { MyPlanningPage } from './screens/planning/MyPlanningPage';
import {
  DevicesPage,
  AgentModePage,
  AiModelsPage,
  AlertsPage,
  BackupsPage,
  PayRulesPage,
  SettingsLayout,
  TelegramPage,
} from './screens/settings/SettingsLayout';
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
import { parseTelegramSearch, searchOfTab, tabOfSearch } from './settings/telegram/search';
import { AppShell } from './shell/AppShell';
import { NotFoundPage } from './shell/NotFoundPage';
import { canOpen, railOf, sectionOf } from './shell/nav';

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

const today = createRoute({ getParentRoute: () => rootRoute, path: '/aujourdhui', component: TodayPage });
const myPlanning = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planning',
  component: function MyPlanning() {
    const { user } = rootRoute.useRouteContext();
    return <MyPlanningPage userId={user.id} />;
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
  validateSearch: parsePlanningSearch,
  component: function TeamPlanning() {
    const { semaine, membre } = teamPlanning.useSearch();
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

const commissions = createRoute({
  getParentRoute: () => rootRoute,
  path: '/commissions',
  component: function Commissions() {
    const { user } = rootRoute.useRouteContext();
    return <CommissionsPage user={user} />;
  },
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
const agentMode = createRoute({ getParentRoute: () => settings, path: '/mode', component: AgentModePage });

const routeTree = rootRoute.addChildren([
  dashboard,
  creators,
  train.addChildren([trainIndex, playground, corrections, tests]),
  tracking,
  trackingAlerts,
  today,
  myPlanning,
  team.addChildren([teamIndex, teamPlanning, teamReports, teamMembers]),
  pay.addChildren([payIndex, payPeriod, payPeriods, payEntries, payGoals]),
  commissions,
  settings.addChildren([settingsIndex, aiModels, alerts, telegram, payRules, backups, devices, agentMode]),
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
