import type { JSX } from 'react';

import { AgencyStrip } from '../AgencyStrip';
import { NoCreator } from '../DashboardPage';
import { OwnerDecisions } from '../OwnerDecisions';
import { TodoCard } from '../TodoCard';
import { useFloatingTip } from '../parts';
import { useDashboard } from '../useDashboard';
import '../dashboard.css';

import { AgencyInsightsPanel } from './AgencyInsights';
import { SteeringPanel } from './Steering';
import { UrgentCard } from './Urgent';
import type { AgencySelection } from './period';

import { useCreators } from '@/creators/api';
import { PageHeader } from '@/shell/layout';

/**
 * The Dashboard of the owner and of an active manager while the menu's selector is on « Toutes » (ADR 0078, ADR 0134
 * § 3): what waits on the reader first (« À faire », pilotage 12/11 W3), then the agency's figures. A creator chosen in the selector, or her line here, opens
 * her Dashboard, her agent first and her figures under it.
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
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  return (
    <div className="db">
      {/* The screen's title, as on every other one (recette visuelle 16/11, PIL-04): the rest of the Dashboard as it was. */}
      <PageHeader title="Dashboard" />
      {/* What waits on the reader, in one card and before the figures, as « Aujourd'hui » does for the team (W3):
          nothing when nothing waits, so the figures stay first on a quiet day. Then the day's AI budget (PIL-04). */}
      {/* The fans who wait, before anything else (grande recette 21/11, point 2): red the grave, amber the rest. */}
      <UrgentCard opensTracking={opensTracking} />
      <TodoCard forOwner={forOwner} reviewsReports={reviewsReports} />
      {/* What her creators have not answered yet, the owner answering in their place (INS-05): here while one ends
          soon, else under the day's goal; nothing if nothing waits. */}
      {forOwner ? <OwnerDecisions creators={creators.data ?? []} showWho at="top" /> : null}
      {/* What the owner steers with, each card tied to a decision (pilotage 21/11), then the period's figures. */}
      <SteeringPanel
        creatorId={null}
        opensTracking={opensTracking}
        tip={tip}
        afterDay={forOwner ? <OwnerDecisions creators={creators.data ?? []} showWho at="under-day" /> : null}
      />
      <AgencyInsightsPanel
        index={4}
        selection={selection}
        onSelection={onSelection}
        creatorId={null}
        onCreator={onCreator}
        canOpenSettings={forOwner}
        tip={tip}
      />
      {view.status === 'live' ? <AgencyStrip agency={view.data.agency} opensSettings={forOwner} /> : null}
      {tip.element}
    </div>
  );
}
