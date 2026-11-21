import {
  ContentDropIdSchema,
  CreatorIdSchema,
  type CreatorId,
  type CreatorSummary,
  type Me,
} from '@impera/contracts';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { useEffect, type JSX } from 'react';

import { followCreator } from './agent/followed';
import { scopeTo, scopedCreatorId, scopedOf, useCreatorScope } from './agent/scope';
import { CreatorsPage } from './creators/CreatorsPage';
import { MyPersonaPage } from './creators/MyPersonaPage';
import { useCreators } from './creators/api';
import {
  creatorsSearch,
  legacyCreatorsSearch,
  parseCreatorsSearch,
  sheetOf,
  sheetsFor,
} from './creators/search';
import { parsePaySearch } from './payroll/model';
import { ExtensionLinkPage } from './pwa/ExtensionLinkPage';
import { ExtensionPage } from './pwa/ExtensionPage';
import { InstallPage } from './pwa/InstallPage';
import { NotificationsPage } from './pwa/NotificationsPage';
import { RevealHelpPage } from './pwa/RevealHelpPage';
import { CreatorRewardRevealGate } from './rewards/CreatorRewardRevealGate';
import { playsTheGame } from './rewards/api';
import { myPlanningSearch, teamPlanningSearch } from './scheduling/calendar';
import { myAwayOf } from './scheduling/model';
import { AgendaPage } from './screens/agenda/AgendaPage';
import { parseAgendaSearch, viewOf, vueOf } from './screens/agenda/search';
import { ContentPage } from './screens/content/ContentPage';
import { ScriptPage } from './screens/content/ScriptPage';
import { DashboardPage } from './screens/dashboard/DashboardPage';
import { AgencyPage } from './screens/dashboard/agency/AgencyPage';
import {
  agencySelectionOf,
  agencySearch,
  agentPeriodOf,
  dashboardSearch,
  parseDashboardSearch,
  periodOf,
} from './screens/dashboard/logic';
import { FansPage } from './screens/fans/FansPage';
import { HerProfilePage } from './screens/me/HerProfilePage';
import { MyCalendarLinkPage } from './screens/me/MyCalendarLinkPage';
import { MyFilePage } from './screens/me/MyFilePage';
import { MyLinksPage } from './screens/me/MyLinksPage';
import { MyOwnInvoicesPage } from './screens/me/MyOwnInvoicesPage';
import { MyPreferencesPage } from './screens/me/MyPreferencesPage';
import { MyProfilePage } from './screens/me/MyProfilePage';
import { MySecurityPage } from './screens/me/MySecurityPage';
import { MyTrophiesPage } from './screens/me/MyTrophiesPage';
import { CommissionsPage } from './screens/pay/CommissionsPage';
import { EntriesPage } from './screens/pay/EntriesPage';
import { ExportsPage } from './screens/pay/ExportsPage';
import { GoalsPage } from './screens/pay/GoalsPage';
import { InvoicesPage } from './screens/pay/InvoicesPage';
import { MyInvoicesPage } from './screens/pay/MyInvoicesPage';
import { PeriodPage } from './screens/pay/PeriodPage';
import { PeriodsPage } from './screens/pay/PeriodsPage';
import { MyPlanningPage, type MyPlanningSearch } from './screens/planning/MyPlanningPage';
import { CreatorSalesPage } from './screens/sales/CreatorSalesPage';
import { parseSalesSearch } from './screens/sales/view';
import {
  AiModelsPage,
  AiUsagePage,
  AlertsPage,
  BackupsPage,
  BillingPage,
  PayRulesPage,
  SalesFeedPage,
  SecurityPage,
  SettingsHome,
  SettingsLayout,
  TelegramPage,
} from './screens/settings/SettingsLayout';
import { AnnouncementsPage } from './screens/team/AnnouncementsPage';
import { MemberFilePage } from './screens/team/MemberFilePage';
import { MembersPage } from './screens/team/MembersPage';
import { PlanningPage } from './screens/team/PlanningPage';
import { ReportsPage } from './screens/team/ReportsPage';
import { RevealPage } from './screens/team/RevealPage';
import { parseReportsSearch, parseTeamSearch } from './screens/team/model';
import { CreatorTodayPage } from './screens/today/CreatorTodayPage';
import { TodayPage } from './screens/today/TodayPage';
import { ChatterTrackingPage } from './screens/tracking/ChatterTrackingPage';
import { readsFans, SuiviNav } from './screens/tracking/SuiviNav';
import { TrackingPage } from './screens/tracking/TrackingPage';
import { AlertHistoryPage } from './screens/tracking/history/AlertHistoryPage';
import { parseTrackingSearch } from './screens/tracking/view';
import { TrafficPage } from './screens/traffic/TrafficPage';
import { ChannelPostPage } from './screens/train/ChannelPostPage';
import { PlaygroundPage } from './screens/train/PlaygroundPage';
import { TrainLayout } from './screens/train/TrainLayout';
import { StructuresPage } from './scripts/StructuresPage';
import { AccountSecurityPage } from './security/AccountSecurityPage';
import { parseTelegramSearch, searchOfTab, tabOfSearch } from './settings/telegram/search';
import { AppShell } from './shell/AppShell';
import { scopesCreators } from './shell/CreatorScope';
import { ErrorPage } from './shell/ErrorPage';
import { NotFoundPage } from './shell/NotFoundPage';
import { ACCOUNT_SECURITY, canOpen, railOf, sectionOf, securityPathOf } from './shell/nav';
import { MyStockPage } from './stock/MyStockPage';

/** What every screen can read: who is signed in, and how to sign out. Given by `App` once the session is known. */
export interface RouterContext {
  readonly user: Me;
  readonly onSignOut: () => void;
}

/** What the shell says when the route guard sends someone to the first tab of their rail (NAV-21). */
export const NOT_YOURS = 'Cette page n’est pas dans ton espace.';

/** What the shell says when an address of Entraîner has no screen yet and leads to the Playground (PIL-17). */
export const NOT_BUILT_YET = 'Cet écran arrive bientôt : tu es sur le Playground.';

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // A section outside the account's rail sends it to its first tab (ADR 0024); the server's 403 stays the barrier.
  beforeLoad: ({ context, location }) => {
    const rail = railOf(context.user);
    const section = sectionOf(location.pathname);
    if (section !== null && !canOpen(rail, section)) {
      // The app's own address (the manifest's `start_url`, opened at each launch) is coming home, not someone else's
      // link: no word for it.
      if (location.pathname === '/') {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
        throw redirect({ to: rail.home, replace: true });
      }
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

/**
 * The creator the menu's selector is set on, for the accounts that have it (`scopesCreators`), `null` on « Toutes ».
 * While the creators are read, the stored choice is trusted, so that her screen does not open on the agency's first;
 * once read, a creator no longer listed counts as « Toutes ».
 */
/** The same empty list at every render, while the creators are read. */
const NO_CREATORS: readonly CreatorSummary[] = [];

function useScopedCreator(enabled: boolean): string | null {
  const { chosen } = useCreatorScope();
  const read = useCreators();
  if (!enabled) return null;
  return read.isSuccess ? (scopedOf(read.data, chosen)?.id ?? null) : chosen;
}

const dashboard = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseDashboardSearch,
  component: function Dashboard() {
    const { user } = rootRoute.useRouteContext();
    const search = dashboard.useSearch();
    const navigate = dashboard.useNavigate();
    // A link that names her opens her Dashboard, and she is followed from then on (recette 05/11, PRO-28).
    const agency = scopesCreators(user);
    const listed = useCreators().data ?? NO_CREATORS;
    useEffect(() => {
      if (search.creatrice === undefined) return;
      if (!agency) {
        followCreator(search.creatrice);
        return;
      }
      // For the accounts with the selector (ADR 0134 § 3), a link that names her sets it on her, and the address lets
      // go of her name: from then on the selector alone says whose Dashboard this is. A creator who is not listed
      // stays in the address: the page says she is not there, rather than open the agency's without a word.
      if (!listed.some((creator) => creator.id === search.creatrice)) return;
      scopeTo(search.creatrice);
      void navigate({ search: agencySearch(agencySelectionOf(search)), replace: true });
    }, [search, agency, navigate, listed]);
    const rail = railOf(user);
    const scoped = useScopedCreator(agency);
    // The agency's figures are the owner's and an active manager's (ADR 0078 § 1): the Dashboard opens on them, or on
    // the creator the selector is set on.
    if (agency) {
      const selection = agencySelectionOf(search);
      const openCreator = (id: string): void => {
        scopeTo(id);
      };
      const shown = search.creatrice ?? scoped ?? undefined;
      if (shown === undefined) {
        return (
          <AgencyPage
            selection={selection}
            onSelection={(next) => void navigate({ search: agencySearch(next), replace: true })}
            onCreator={openCreator}
            forOwner={user.role === 'owner'}
            reviewsReports={canOpen(rail, '/equipe')}
            opensTracking={canOpen(rail, '/suivi')}
            canAddCreator={user.role === 'owner'}
          />
        );
      }
      return (
        <DashboardPage
          period={agentPeriodOf(selection)}
          onPeriod={() => undefined}
          onCreator={openCreator}
          forOwner={user.role === 'owner'}
          reviewsReports={canOpen(rail, '/equipe')}
          opensTracking={canOpen(rail, '/suivi')}
          canAddCreator={user.role === 'owner'}
          asked={shown}
          agency={{
            selection,
            onSelection: (next) => void navigate({ search: agencySearch(next), replace: true }),
            onAgency: () => {
              scopeTo(null);
            },
            canOpenSettings: user.role === 'owner',
          }}
        />
      );
    }
    return (
      <DashboardPage
        period={periodOf(search)}
        onPeriod={(next) => void navigate({ search: dashboardSearch(next, search.creatrice), replace: true })}
        onCreator={(id) => void navigate({ search: dashboardSearch(periodOf(search), id), replace: true })}
        forOwner={false}
        reviewsReports={canOpen(rail, '/equipe')}
        opensTracking={canOpen(rail, '/suivi')}
        canAddCreator={user.role === 'owner'}
        asked={search.creatrice}
        onLeave={() => void navigate({ search: dashboardSearch(periodOf(search)), replace: true })}
      />
    );
  },
});
const creators = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creatrices',
  validateSearch: parseCreatorsSearch,
  // Her hours (P3-14), her access (CR-02) and the agency's percentage (CR-04) are the owner's alone, her agenda (CR-05)
  // the owner's and an active manager's, who opens nothing else: anyone lands on their first sheet, never on a page
  // the server would refuse.
  beforeLoad: ({ context, search, location }) => {
    // An address of the tabs before the seven (ADR 0149 § 5) leads to where its screen lives now, the creator kept:
    // her links to Trafic, the others to their tab, their view or their card of Compte.
    const raw: Record<string, unknown> = location.search;
    if (raw['onglet'] === 'liens') {
      const creatrice = search.creatrice;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({
        to: '/trafic',
        search: creatrice === undefined ? {} : { creatrice },
        replace: true,
      });
    }
    const legacy = legacyCreatorsSearch(raw);
    if (legacy !== null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({
        to: '/creatrices',
        search: legacy.search,
        replace: true,
        ...(legacy.hash === undefined ? {} : { hash: legacy.hash }),
      });
    }
    const sheets = sheetsFor(context.user);
    const first = sheets[0];
    if (first !== undefined && !sheets.includes(sheetOf(search))) {
      // A word brought by an earlier guard (Structures sends here) goes on with this second step. A sheet asked by name
      // and refused says why, as any page that is not one's (PIL-26); no sheet asked lands on the first one, silently.
      const notice = location.state.notice ?? (search.onglet === undefined ? undefined : NOT_YOURS);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({
        to: '/creatrices',
        search: creatorsSearch(first, search.creatrice ?? null),
        replace: true,
        ...(notice === undefined ? {} : { state: { notice } }),
      });
    }
  },
  component: function Creators() {
    const { user } = rootRoute.useRouteContext();
    const search = creators.useSearch();
    const creatrice = search.creatrice;
    const navigate = creators.useNavigate();
    const tab = sheetOf(search);
    // Here the address is the choice (ADR 0134 § 3): her sheet sets the selector on her, the list on « Toutes ». The
    // menu's link carries the creator chosen, so that Créatrices opens on her.
    const chooses = scopesCreators(user);
    useEffect(() => {
      if (chooses) scopeTo(creatrice ?? null);
    }, [chooses, creatrice]);
    return (
      <CreatorsPage
        tab={tab}
        creatorId={creatrice ?? null}
        onCreator={(id) => void navigate({ search: creatorsSearch(tab, id) })}
        folderId={search.dossier ?? null}
        onFolder={(id) => void navigate({ search: creatorsSearch(tab, creatrice ?? null, id) })}
      />
    );
  },
});
/**
 * Créatrices › Structures (SC-01 lot c): the agency's script structures, the owner's alone as the server writes them;
 * anyone else lands on Créatrices.
 */
const scriptStructures = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creatrices/structures',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/creatrices', replace: true, state: { notice: NOT_YOURS } });
    }
    // With a creator chosen, the structures are a view of her sheet's Scripts (ADR 0149 § 5); on « Toutes » there is no
    // sheet to open them in, and this page stays theirs.
    const creator = CreatorIdSchema.safeParse(scopedCreatorId());
    if (creator.success) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({
        to: '/creatrices',
        search: creatorsSearch('structures', creator.data),
        replace: true,
      });
    }
  },
  component: StructuresPage,
});
/**
 * Agence › Trafic (ADR 0134 § 5, ADR 0149 § 2): what brings fans to a creator, her redirect links first. The owner's
 * and an active manager's (ADR 0121 § 4); the root's guard sends anyone else to their first screen.
 */
const traffic = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trafic',
  validateSearch: (search: Record<string, unknown>): { readonly creatrice?: CreatorId } => {
    const creator = CreatorIdSchema.safeParse(search['creatrice']);
    return creator.success ? { creatrice: creator.data } : {};
  },
  component: function Traffic() {
    const { user } = rootRoute.useRouteContext();
    const { creatrice } = traffic.useSearch();
    // A link that names a creator sets the selector on her, as on Suivi.
    const chooses = scopesCreators(user);
    useEffect(() => {
      if (chooses && creatrice !== undefined) scopeTo(creatrice);
    }, [chooses, creatrice]);
    return <TrafficPage scoped={useScopedCreator(chooses)} canEdit={user.role === 'owner'} />;
  },
});
// Suivi › Fans: every fan of a creator (ADR 0124), the owner's and an active manager's, a sub-tab of Suivi (ADR 0134
// § 5). Anyone else is sent back to his own Suivi.
const fansList = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suivi/fans',
  beforeLoad: ({ context }) => {
    if (!readsFans(context.user)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/suivi', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function Fans() {
    const { user } = rootRoute.useRouteContext();
    return <FansPage nav={<SuiviNav fans />} scoped={useScopedCreator(scopesCreators(user))} />;
  },
});
// The address Fans had as a section of its own: shared links and bookmarks keep working (ADR 0134 § 10).
const fansOld = createRoute({
  getParentRoute: () => rootRoute,
  path: '/fans',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/suivi/fans', replace: true });
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
    // A link that names her conversation's creator sets the selector on her: her line is then on screen.
    const chooses = scopesCreators(user);
    useEffect(() => {
      if (chooses && creatrice !== undefined) scopeTo(creatrice);
    }, [chooses, creatrice]);
    const scoped = useScopedCreator(chooses);
    const props = {
      selected: conversation ?? null,
      selectedCreator: creatrice ?? null,
      onSelect: (id: string | null) => void navigate({ search: id === null ? {} : { conversation: id } }),
      canDecide: user.role !== 'creator',
      // Only the owner adds a creator (Créatrices): no one else is asked to (DASH-13).
      canAddCreator: user.role === 'owner',
      liftsStop: user.role === 'owner',
    };
    // A chatter reads Suivi within his shift (EQ-13): outside it, the page says so; away, it says that (CHAT-09).
    return rail.kind === 'chatter' ? (
      <ChatterTrackingPage {...props} away={myAwayOf(user)} />
    ) : (
      <TrackingPage {...props} only={scoped} nav={<SuiviNav fans={readsFans(user)} />} />
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
      throw redirect({ to: '/suivi', replace: true, state: { notice: NOT_YOURS } });
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
        nav={<SuiviNav fans={readsFans(user)} />}
      />
    );
  },
});

const today = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aujourdhui',
  // A creator's day is who chats for her (ADR 0042 § 8); a chatter's, his own shift.
  component: function Today() {
    const { user } = rootRoute.useRouteContext();
    return user.role === 'creator' ? (
      <>
        <CreatorTodayPage />
        <CreatorRewardRevealGate user={user} />
      </>
    ) : (
      <TodayPage user={user} />
    );
  },
});
/**
 * Agenda, the creator's alone (CR-05, ADR 0042 § 8): her day (`?jour=`), her week (`?vue=semaine`) or her month
 * (`?vue=mois`). Any other account is sent home by the root, as this section is not on its rail.
 */
const agenda = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agenda',
  validateSearch: parseAgendaSearch,
  component: function Agenda() {
    const { user } = rootRoute.useRouteContext();
    const search = agenda.useSearch();
    const navigate = agenda.useNavigate();
    return (
      <>
        <CreatorRewardRevealGate user={user} />
        <AgendaPage
          day={search.jour ?? null}
          view={viewOf(search)}
          onDay={(day) =>
            void navigate({
              search: ({ vue }) => ({
                ...(day === null ? {} : { jour: day }),
                ...(vue === undefined ? {} : { vue }),
              }),
              replace: true,
            })
          }
          onView={(view) =>
            void navigate({
              search: ({ jour }) => ({
                ...(jour === undefined ? {} : { jour }),
                ...vueOf(view),
              }),
            })
          }
        />
      </>
    );
  },
});
/**
 * Ventes, the creator's alone (ADR 0042 § 8): her fans, and a conversation opened from one of them (`?conversation=`).
 * Any other account is sent home by the root, as this section is not on its rail.
 */
const sales = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ventes',
  validateSearch: parseSalesSearch,
  component: function Sales() {
    const { conversation } = sales.useSearch();
    const navigate = sales.useNavigate();
    return (
      <CreatorSalesPage
        selected={conversation ?? null}
        onSelect={(id) => void navigate({ search: id === null ? {} : { conversation: id } })}
      />
    );
  },
});
/**
 * Contenu, the creator's alone (CR-06 d, ADR 0055 § 8): what she is asked for, what she drops, where it is. Any other
 * account is sent home by the root, as this section is not on its rail.
 */
const content = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contenu',
  // `?demande=`: Aujourd'hui's « Déposer » opens the sheet on that request (recette visuelle 16/11, CRE-01).
  validateSearch: (search: Record<string, unknown>): { readonly demande?: string } => {
    const { demande } = search;
    return typeof demande === 'string' && /^[0-9a-f-]{36}$/iu.test(demande) ? { demande } : {};
  },
  component: function Content() {
    const { user } = rootRoute.useRouteContext();
    const navigate = content.useNavigate();
    const { demande } = content.useSearch();
    return (
      <>
        <ContentPage
          onOpenScript={(dropId) => void navigate({ to: '/contenu/script/$dropId', params: { dropId } })}
          onOpenStock={() => void navigate({ to: '/contenu/coffre' })}
          asked={demande ?? null}
          onAsked={() => void navigate({ to: '/contenu', replace: true })}
        />
        <CreatorRewardRevealGate user={user} />
      </>
    );
  },
});
/** Mon coffre (ADR 0162 § 5): what she dropped, by use, with what the AI understood of each medium. */
const contentStock = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contenu/coffre',
  component: function ContentStock() {
    const navigate = contentStock.useNavigate();
    return <MyStockPage onDrop={() => void navigate({ to: '/contenu' })} />;
  },
});
/** Her script, card by card (SC-02 lot b2): a drop of hers, by its id; any other address goes back to Contenu. */
const contentScript = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contenu/script/$dropId',
  beforeLoad: ({ params }) => {
    if (!ContentDropIdSchema.safeParse(params.dropId).success) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/contenu', replace: true });
    }
  },
  component: function ContentScript() {
    const { dropId } = contentScript.useParams();
    const navigate = contentScript.useNavigate();
    return (
      <ScriptPage
        dropId={ContentDropIdSchema.parse(dropId)}
        onBack={() => void navigate({ to: '/contenu' })}
      />
    );
  },
});
const myPlanning = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planning',
  validateSearch: (search: Record<string, unknown>): MyPlanningSearch => myPlanningSearch(search),
  component: function MyPlanning() {
    const { user } = rootRoute.useRouteContext();
    const search = myPlanning.useSearch();
    const navigate = myPlanning.useNavigate();
    return (
      <MyPlanningPage
        userId={user.id}
        away={myAwayOf(user)}
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
  validateSearch: teamPlanningSearch,
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
        seesSetup={user.role === 'owner' || user.teamScope === 'agency'}
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

// Reveal's team reviewed (ADR 0076), the owner's and an active manager's: anyone else is sent back to the members.
/** Équipe › Annonces (EQ-12): the owner's and the managers', who see Équipe; the server refuses anyone else. */
const teamAnnouncements = createRoute({
  getParentRoute: () => team,
  path: '/annonces',
  component: function TeamAnnouncements() {
    const { user } = rootRoute.useRouteContext();
    return <AnnouncementsPage owner={user.role === 'owner'} />;
  },
});

const teamReveal = createRoute({
  getParentRoute: () => team,
  path: '/reveal',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner' && context.user.teamScope !== 'agency') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/equipe/membres', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function TeamReveal() {
    const { user } = rootRoute.useRouteContext();
    const navigate = teamReveal.useNavigate();
    return (
      <RevealPage
        platform="reveal"
        bounded={user.role !== 'owner'}
        ownCreatorIds={user.creatorIds}
        onOpenMember={(id) => void navigate({ to: '/equipe/membres', search: { membre: id } })}
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
      // Said as at the rail's door (NAV-21): a pasted link to a file is not a broken page (recette EQP-03).
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/equipe/membres', replace: true, state: { notice: NOT_YOURS } });
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
  // The quinzaine the other tabs showed, kept for the way back to them (GES-02).
  validateSearch: parsePaySearch,
  component: function PayPeriods() {
    const { quinzaine } = payPeriods.useSearch();
    const navigate = payPeriods.useNavigate();
    const { user } = rootRoute.useRouteContext();
    return (
      <PeriodsPage
        user={user}
        period={quinzaine ?? null}
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
      // Said as at the rail's door (NAV-21): the exports are not a broken page (recette EQP-03).
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/paie/quinzaine', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  validateSearch: parsePaySearch,
  component: function PayExports() {
    const { quinzaine } = payExports.useSearch();
    const { user } = rootRoute.useRouteContext();
    return <ExportsPage user={user} period={quinzaine ?? null} />;
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
    // Everyone's Moi opens on a short profile: a team member's file, a task of once in a while, is the next tab
    // (CHAT-30); a creator's persona, the longest page of the app, too (recette visuelle 16/11, CRE-03).
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/moi/profil', replace: true });
  },
});
/**
 * A creator's Moi holds her profile, her persona and her security (ADR 0042 § 8, CRE-03): a team member's screens (his
 * file, his invoices, his calendar of shifts) send her to her profile, as her persona sends anyone else to his.
 */
/** Said once to who opens the old address of Moi › Calendrier: where the link went. */
const CALENDAR_MOVED = 'Ton lien de calendrier est ici maintenant : « Dans mon téléphone ».';
const creatorAway = ({ context }: { context: RouterContext }): void => {
  if (context.user.role === 'creator') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/moi/profil', replace: true, state: { notice: NOT_YOURS } });
  }
};
const mePersona = createRoute({
  getParentRoute: () => me,
  path: '/persona',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'creator') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/moi/profil', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: MyPersonaPage,
});
// Moi › Mes liens (INS-03, ADR 0121 § 1): hers alone; anyone else is sent to his profile.
const meLinks = createRoute({
  getParentRoute: () => me,
  path: '/liens',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'creator') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/moi/profil', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: MyLinksPage,
});
const meProfile = createRoute({
  getParentRoute: () => me,
  path: '/profil',
  // Its return type is written: inferred from a choice on the context, it made the route tree's types circular.
  component: function MyProfile(): JSX.Element {
    const { user } = rootRoute.useRouteContext();
    return user.role === 'creator' ? <HerProfilePage user={user} /> : <MyProfilePage user={user} />;
  },
});
// Moi › Trophées (ADR 0108): the chatter's trophy case, or the creator's; anyone else is sent to his profile.
const meTrophies = createRoute({
  getParentRoute: () => me,
  path: '/trophees',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'creator' && !playsTheGame(context.user)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/moi/profil', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function MyTrophies() {
    const { user } = rootRoute.useRouteContext();
    return <MyTrophiesPage user={user} />;
  },
});
const meFile = createRoute({
  getParentRoute: () => me,
  path: '/dossier',
  beforeLoad: creatorAway,
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
    creatorAway({ context });
    if (context.user.teamScope !== 'agency') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/commissions/factures', replace: true, state: { notice: NOT_YOURS } });
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
  // A chatter's link now lives on Planning, « Dans mon téléphone » (ADR 0134, lot 1): the old address opens it there.
  beforeLoad: (options) => {
    creatorAway(options);
    if (canOpen(railOf(options.context.user), '/planning')) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/planning', replace: true, state: { notice: CALENDAR_MOVED } });
    }
  },
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

const mePreferences = createRoute({
  getParentRoute: () => me,
  path: '/preferences',
  component: function MyPreferences() {
    const { user, onSignOut } = rootRoute.useRouteContext();
    return <MyPreferencesPage user={user} onSignOut={onSignOut} />;
  },
});

// Outside the rail (SEC-04): an operator's own sessions and backup codes, from the account's menu. Whoever has them in
// a section reads them there, and this address leads to it with its query (recette visuelle 16/11, CHA-16, CRE-07,
// GES-11): one page, not two.
const accountSecurity = createRoute({
  getParentRoute: () => rootRoute,
  path: ACCOUNT_SECURITY,
  beforeLoad: ({ context }) => {
    const own = securityPathOf(context.user);
    if (own !== ACCOUNT_SECURITY) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: own, search: true, hash: true, replace: true });
    }
  },
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
const channelPost = createRoute({
  getParentRoute: () => train,
  path: '/canal',
  // Her channel's posts are the owner's (ADR 0092 § 8): a manager who has the address finds the Playground.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/entrainer/playground', replace: true });
    }
  },
  component: ChannelPostPage,
});
/*
 * Corrections and Tests have no screen yet, hence no tab (ADR 0024): their addresses lead to the Playground rather than
 * to an « à venir » page under its header (recette 05/11, PRO-25), and say so on arrival (recette visuelle 16/11,
 * PIL-17). Each comes back with its screen.
 */
const corrections = createRoute({
  getParentRoute: () => train,
  path: '/corrections',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/entrainer/playground', replace: true, state: { notice: NOT_BUILT_YET } });
  },
});
const tests = createRoute({
  getParentRoute: () => train,
  path: '/tests',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/entrainer/playground', replace: true, state: { notice: NOT_BUILT_YET } });
  },
});

const settings = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reglages',
  component: SettingsLayout,
});
const settingsIndex = createRoute({
  getParentRoute: () => settings,
  path: '/',
  // Réglages is the owner's alone (the root sends anyone else home). On a phone it is the list of its sections; on a
  // computer, where the list stands beside a section, it opens on the first (GES-04).
  component: SettingsHome,
});
const aiModels = createRoute({
  getParentRoute: () => settings,
  path: '/modeles-ia',
  // The owner's alone, as the server serves the keys: anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: AiModelsPage,
});
const aiUsage = createRoute({
  getParentRoute: () => settings,
  path: '/consommation-ia',
  // The owner's alone (ADR 0091), as the server serves the spend and the credits: anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: AiUsagePage,
});
const salesFeeds = createRoute({
  getParentRoute: () => settings,
  path: '/ventes',
  // The owner's alone, as the server serves the key and the links (ADR 0050 § 4): anyone else is sent to Réglages.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
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
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
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
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: AlertsPage,
});
// Appareils has no screen yet (it comes with the extension's), hence no tab: its address leads to Réglages (PRO-25).
const devices = createRoute({
  getParentRoute: () => settings,
  path: '/appareils',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/reglages', replace: true });
  },
});
const backups = createRoute({
  getParentRoute: () => settings,
  path: '/sauvegardes',
  // The owner's alone (ADR 0028): anyone else is sent to Réglages, not to a page the server would refuse.
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
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
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
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
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
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
      throw redirect({ to: '/reglages', replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function Security() {
    const { user } = rootRoute.useRouteContext();
    return <SecurityPage userId={user.id} />;
  },
});
// The agent's mode changes at the top of the Dashboard: the old address leads to Réglages, not to an orphan line (PRO-25).
const agentMode = createRoute({
  getParentRoute: () => settings,
  path: '/mode',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ to: '/reglages', replace: true });
  },
});

/** /aide/installer (CR-01): open to every role, outside the rail (no section, so the guard lets it through). */
const installHelp = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aide/installer',
  component: InstallPage,
});
/**
 * /aide/extension (ADR 0067): the extension's guide, outside the rail like the phone's; the menu offers it to the team,
 * and its address too: a creator is sent home like any page that is not hers (recette 05/11, CREA-13).
 */
const extensionHelp = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aide/extension',
  beforeLoad: ({ context }) => {
    if (context.user.role === 'creator') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: railOf(context.user).home, replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: function ExtensionHelp() {
    const { user } = rootRoute.useRouteContext();
    // The trend watch is the owner's alone (ADR 0024, amendement du 16/11): the team is shown the copilot instead.
    return <ExtensionPage watches={user.role === 'owner'} />;
  },
});
/**
 * /extension/lier (ADR 0067, amendement du 19/11): the page whose address the extension recognises to link itself to
 * this CRM. Open to whoever has the guide; a creator is sent home like from the guide.
 */
const extensionLink = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extension/lier',
  beforeLoad: ({ context }) => {
    if (context.user.role === 'creator') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: railOf(context.user).home, replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: ExtensionLinkPage,
});
/** /aide/reveal (P2-01): reconnect Reveal with the extension's « Sync », the owner's alone like the button itself. */
const revealHelp = createRoute({
  getParentRoute: () => rootRoute,
  path: '/aide/reveal',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'owner') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing.
      throw redirect({ to: railOf(context.user).home, replace: true, state: { notice: NOT_YOURS } });
    }
  },
  component: RevealHelpPage,
});
/** /notifications (CR-01): every role, from the account's menu; this device and the account's quiet hours. */
const notifications = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: function Notifications() {
    const { user } = rootRoute.useRouteContext();
    // The creator has no shift (ADR 0049 § 4): her words never speak of one (CREA-12).
    return <NotificationsPage creator={user.role === 'creator'} />;
  },
});

const routeTree = rootRoute.addChildren([
  installHelp,
  extensionHelp,
  extensionLink,
  revealHelp,
  notifications,
  dashboard,
  creators,
  scriptStructures,
  train.addChildren([trainIndex, playground, channelPost, corrections, tests]),
  tracking,
  trackingAlerts,
  traffic,
  fansList,
  fansOld,
  today,
  agenda,
  sales,
  content,
  contentStock,
  contentScript,
  myPlanning,
  team.addChildren([
    teamIndex,
    teamPlanning,
    teamReports,
    teamMembers,
    teamMemberFile,
    teamAnnouncements,
    teamReveal,
  ]),
  pay.addChildren([payIndex, payPeriod, payPeriods, payEntries, payGoals, payInvoices, payExports]),
  commissions.addChildren([commissionsIndex, commissionsInvoices]),
  me.addChildren([
    meIndex,
    mePersona,
    meProfile,
    meTrophies,
    meFile,
    meInvoices,
    meCalendar,
    meLinks,
    meSecurity,
    mePreferences,
  ]),
  accountSecurity,
  settings.addChildren([
    settingsIndex,
    aiModels,
    salesFeeds,
    aiUsage,
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
    // A screen that throws says so in French, the rail kept, never the router's « Something went wrong! » (CHT-06).
    defaultErrorComponent: ErrorPage,
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
