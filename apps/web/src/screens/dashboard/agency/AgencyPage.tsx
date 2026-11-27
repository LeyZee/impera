import { useState, type JSX, type ReactNode } from 'react';

import { AgencyStrip } from '../AgencyStrip';
import { NoCreator } from '../DashboardPage';
import { OwnerDecisions } from '../OwnerDecisions';
import { TodoCard } from '../TodoCard';
import { Section, useFloatingTip } from '../parts';
import { useDashboard } from '../useDashboard';
import '../dashboard.css';

import {
  AgencyInsightsPanel,
  Comparable,
  Creators,
  Figures,
  Hours,
  Refunds,
  Ring,
  Sellers,
  Settled,
  Subscribers,
} from './AgencyInsights';
import { Dig, type DigItem } from './Dig';
import { ObjectivesCard } from './Objectives';
import { OwnerMoney } from './OwnerMoney';
import { PeriodBar } from './PeriodBar';
import { DependencyCard, TrafficCard } from './Steering';
import { UrgentCard } from './Urgent';
import { NotYours, useAgencyInsights, useAgencySteering } from './api';
import {
  creatorsLine,
  dependencyLine,
  detailLine,
  hoursLine,
  kindsLine,
  refundsLine,
  sellersLine,
  subscribersLine,
  trafficLine,
} from './owner';
import { againstText, comparable, conclusionWait, readName, type AgencySelection } from './period';
import { kindSlices } from './view';
import './owner.css';

import { useCreators } from '@/creators/api';
import { PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

/** Small line icons of the folded cards, drawn in the menu's stroke. */
function Icon({ d }: { d: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  sellers: 'M8 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 20c1-3 3-5 6-5s5 2 6 5M15 8h6M15 12h6M15 16h4',
  kinds: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 4v8l6 4',
  creators: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  traffic: 'M4 5h16l-6 7v6l-4 2v-8z',
  fans: 'M12 3l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 10l6-1z',
  hours: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  subscribers: 'M10 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM3 21c1.3-4 4-6 7-6M18 14v6M15 17h6',
  refunds: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  detail: 'M4 6h16M4 12h16M4 18h10',
} as const;

/**
 * The Dashboard of the owner and of an active manager while the menu's selector is on « Toutes » (ADR 0078, ADR 0134
 * § 3), laid out as the maquette of 27/11 (audit des tableaux de bord, D1 to D5): the period first, at the top; what
 * waits on the reader (« À toi »); the money in one band, one figure and one curve; then every analysis folded on the
 * line that answers it. A creator chosen in the selector opens her Dashboard, which keeps its own layout.
 */
export function AgencyPage({
  selection,
  onSelection,
  onCreator,
  forOwner,
  reviewsReports,
  opensTracking,
  canAddCreator,
}: {
  selection: AgencySelection;
  onSelection: (selection: AgencySelection) => void;
  onCreator: (creatorId: string) => void;
  /** The owner also reads the daily export and the invoices' paperwork, and links the registers. */
  forOwner: boolean;
  /** The account reviews the team's reports (ADR 0073). */
  reviewsReports: boolean;
  /** The account opens Suivi: a lapsed payer leads to his conversation. */
  opensTracking: boolean;
  /** The owner, who alone adds a creator: before any creator, the screen leads him to Créatrices (DASH-13). */
  canAddCreator: boolean;
}): JSX.Element {
  const tip = useFloatingTip();
  // The followed creator's Dashboard also carries what is the agency's (the day's AI budget, the stuck jobs), and
  // says when there is no creator yet: then the screen leads to Créatrices, never to empty charts.
  const view = useDashboard('week', forOwner ? 'owner' : 'team');
  const creators = useCreators();
  const insights = useAgencyInsights(selection, null);
  const steering = useAgencySteering(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  const toggle = (key: string, open: boolean): void => {
    setOpened((now) => {
      const next = new Set(now);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const openObjectives = (): void => {
    toggle('creators', true);
    requestAnimationFrame(() => {
      document.getElementById('creuser-creators')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const data = insights.data;
  return (
    <div className="db own">
      {/* The period at the top (D3): the money and the folded cards follow it, « À toi » is now. */}
      <PageHeader
        title="Dashboard"
        actions={
          insights.error instanceof NotYours ? undefined : (
            <PeriodBar selection={selection} insights={data ?? null} onChange={onSelection} />
          )
        }
      />

      {/* What waits on the reader, before any figure; nothing when nothing waits (the heading goes with it). */}
      <section className="db-sect own-todo nv-enter" style={{ '--nv-i': 1 }} aria-labelledby="own-todo-title">
        <div className="db-sect__head">
          <h2 className="nv-h2" id="own-todo-title">
            À toi<span className="db-sect__sub">maintenant</span>
          </h2>
        </div>
        <div className="own-todo__body">
          <UrgentCard opensTracking={opensTracking} />
          <TodoCard forOwner={forOwner} reviewsReports={reviewsReports} />
          {forOwner ? <OwnerDecisions creators={creators.data ?? []} showWho at="top" /> : null}
        </div>
      </section>

      {insights.error instanceof NotYours ? null : data === undefined ? (
        <Section title="L’argent" sub="lu dans le registre des ventes" index={2}>
          {insights.isError ? (
            <Failure onRetry={() => void insights.refetch()} />
          ) : (
            <div
              className="db-loading nv-plate own-loading"
              role="status"
              aria-busy="true"
              aria-label="Chargement des chiffres"
            />
          )}
        </Section>
      ) : data.creators.length === 0 ? (
        // No creator linked to the register yet: the panel says so and leads to the setting, as before.
        <AgencyInsightsPanel
          index={2}
          selection={selection}
          onSelection={onSelection}
          creatorId={null}
          onCreator={onCreator}
          canOpenSettings={forOwner}
          tip={tip}
        />
      ) : (
        <Comparable.Provider value={comparable(data)}>
          <Settled.Provider value={conclusionWait(data) === null}>
            <div className="ins-body own-body" aria-busy={insights.isPlaceholderData}>
              <Section title="L’argent" sub={`${readName(data)}, ${againstText(data)}`} index={2}>
                <OwnerMoney
                  insights={data}
                  steering={steering.data}
                  canSetObjective={forOwner}
                  onSetObjective={openObjectives}
                  tip={tip}
                />
                {data.dollarsLeftOut ? (
                  <p className="ins-note" role="note">
                    Des ventes en dollars sont laissées de côté : aucun taux de change n’est encore connu
                    (Équipe › Paie).
                  </p>
                ) : null}
              </Section>
              <Section
                title="Pour creuser"
                sub="suivent la période choisie en haut ; le trafic et les gros fans, les 30 derniers jours"
                index={3}
              >
                <Dig
                  items={digItems({
                    insights: data,
                    steering: steering.data,
                    forOwner,
                    opensTracking,
                    onCreator,
                    tip,
                  })}
                  opened={opened}
                  onToggle={toggle}
                />
              </Section>
            </div>
          </Settled.Provider>
        </Comparable.Provider>
      )}
      {view.status === 'live' ? <AgencyStrip agency={view.data.agency} opensSettings={forOwner} /> : null}
      {tip.element}
    </div>
  );
}

/** The folded cards, in the order of the maquette: who sold first, the detail of the money last. */
function digItems({
  insights,
  steering,
  forOwner,
  opensTracking,
  onCreator,
  tip,
}: {
  insights: NonNullable<ReturnType<typeof useAgencyInsights>['data']>;
  steering: ReturnType<typeof useAgencySteering>['data'];
  forOwner: boolean;
  opensTracking: boolean;
  onCreator: (creatorId: string) => void;
  tip: ReturnType<typeof useFloatingTip>;
}): DigItem[] {
  const several = insights.creators.length >= 2;
  const objectives = insights.objectives;
  const icon = (key: keyof typeof ICONS): ReactNode => <Icon d={ICONS[key]} />;
  const items: DigItem[] = [
    {
      key: 'sellers',
      title: 'Qui a vendu',
      icon: icon('sellers'),
      answer: sellersLine(insights),
      silent: 'qui a vendu',
      body: () => <Sellers insights={insights} tip={tip} />,
    },
    {
      key: 'kinds',
      title: 'D’où vient l’argent',
      icon: icon('kinds'),
      answer: kindsLine(insights.kinds),
      silent: 'd’où vient l’argent',
      body: () => (
        <Ring title="D’où vient l’argent" slices={kindSlices(insights.kinds)} tipFor="other" tip={tip} bare />
      ),
    },
    {
      key: 'creators',
      title: several ? 'Les créatrices et leurs objectifs' : 'L’objectif du mois',
      icon: icon('creators'),
      // The objectives are set here (owner): the card stays listed for the month even before a sale.
      answer:
        creatorsLine(insights) ??
        (objectives === null ? null : several ? 'Leurs objectifs du mois' : 'Son objectif du mois'),
      silent: 'les créatrices côte à côte',
      body: () => (
        <div className="own-dig__stack">
          {several ? <Creators insights={insights} onCreator={onCreator} tip={tip} /> : null}
          {objectives === null ? null : (
            <ObjectivesCard insights={insights} objectives={objectives} canEdit={forOwner} />
          )}
        </div>
      ),
    },
  ];
  if (steering !== undefined && steering.creators.length > 0) {
    items.push(
      {
        key: 'traffic',
        title: 'Du trafic à l’argent',
        icon: icon('traffic'),
        answer: trafficLine(steering.traffic),
        silent: 'du trafic à l’argent',
        body: () => <TrafficCard traffic={steering.traffic} tip={tip} />,
      },
      {
        key: 'fans',
        title: 'Gros fans',
        icon: icon('fans'),
        answer: dependencyLine(steering.dependency),
        silent: 'les gros fans',
        body: () => <DependencyCard steering={steering} opensTracking={opensTracking} tip={tip} />,
      },
    );
  }
  items.push(
    {
      key: 'hours',
      title: 'Quand ça vend',
      icon: icon('hours'),
      // Too few sales to say when it sells (ADR 0092 § 5): the card waits, named in the quiet line (D5).
      answer: conclusionWait(insights) === null ? hoursLine(insights.hours) : null,
      silent: 'quand ça vend (pas encore assez de ventes)',
      body: () => <Hours insights={insights} tip={tip} />,
    },
    {
      key: 'subscribers',
      title: 'Les abonnés',
      icon: icon('subscribers'),
      answer: subscribersLine(insights.subscribers),
      silent: 'les abonnés (en attente des statistiques de Reveal)',
      body: () => (
        <Comparable.Provider value>
          <Settled.Provider value>
            <Subscribers insights={insights} tip={tip} />
          </Settled.Provider>
        </Comparable.Provider>
      ),
    },
    {
      key: 'refunds',
      title: 'Les remboursements',
      icon: icon('refunds'),
      answer: refundsLine(insights),
      silent: '',
      body: () => <Refunds insights={insights} />,
    },
    {
      key: 'detail',
      title: 'Le détail de l’argent',
      icon: icon('detail'),
      answer: insights.totals.current.revenueMinor > 0 ? detailLine(insights.totals.current) : null,
      silent: '',
      body: () => <Figures insights={insights} several={several} tip={tip} detailOnly />,
    },
    {
      // Counted after the opening (fil « Compter les fans brûlés »): named here until its card exists.
      key: 'burned',
      title: 'Fans brûlés',
      icon: null,
      answer: null,
      silent: 'les fans brûlés (compteur en préparation)',
      body: () => null,
    },
  );
  // A card with nothing to say and nothing worth naming (no refund, no sale) is left out of the quiet line too.
  return items.filter((item) => item.answer !== null || item.silent !== '');
}
