import type { JSX } from 'react';

import { AgencyStrip } from '../AgencyStrip';
import { NoCreator } from '../DashboardPage';
import { TodoCard } from '../TodoCard';
import { useFloatingTip } from '../parts';
import { useDashboard } from '../useDashboard';
import '../dashboard.css';

import { AgencyInsightsPanel } from './AgencyInsights';
import type { AgencySelection } from './period';

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
  canAddCreator,
}: {
  selection: AgencySelection;
  onSelection: (selection: AgencySelection) => void;
  onCreator: (creatorId: string) => void;
  /** The owner also reads the daily export and the invoices' paperwork, and links the registers. */
  forOwner: boolean;
  /** The account reviews the team's reports (ADR 0073). */
  reviewsReports: boolean;
  /** The account's rail holds Créatrices: before any creator, the screen leads there (DASH-13). */
  canAddCreator: boolean;
}): JSX.Element {
  const tip = useFloatingTip();
  // The followed creator's Dashboard also carries what is the agency's (the day's AI budget, the stuck jobs), and
  // says when there is no creator yet: then the screen leads to Créatrices, never to empty charts.
  const view = useDashboard('week', forOwner ? 'owner' : 'team');
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  return (
    <div className="db">
      {/* The screen's title, as on every other one (recette visuelle 16/11, PIL-04): the rest of the Dashboard as it was. */}
      <PageHeader title="Dashboard" />
      {/* What waits on the reader, in one card and before the figures, as « Aujourd'hui » does for the team (W3):
          nothing when nothing waits, so the figures stay first on a quiet day. Then the day's AI budget (PIL-04). */}
      <TodoCard forOwner={forOwner} reviewsReports={reviewsReports} />
      <AgencyInsightsPanel
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
