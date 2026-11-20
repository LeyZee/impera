import type { JSX } from 'react';

import { AgencyStrip } from '../AgencyStrip';
import { BackupBanner } from '../BackupBanner';
import { NoCreator } from '../DashboardPage';
import { PaperworkBanner } from '../PaperworkBanner';
import { ReportsBanner } from '../ReportsBanner';
import { useFloatingTip } from '../parts';
import { useDashboard } from '../useDashboard';
import '../dashboard.css';

import { AgencyInsightsPanel } from './AgencyInsights';
import type { AgencySelection } from './period';

import { PageHeader } from '@/shell/layout';

/**
 * The Dashboard of the owner and of an active manager while the menu's selector is on « Toutes » (ADR 0078, ADR 0134
 * § 3): the agency's figures, then what waits on the agency. A creator chosen in the selector, or her line here, opens
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
      {/* The figures first, then what the agency runs: the export, the invoices, the reports, the day's AI budget
          (recette visuelle 16/11, PIL-04). */}
      <AgencyInsightsPanel
        selection={selection}
        onSelection={onSelection}
        creatorId={null}
        onCreator={onCreator}
        canOpenSettings={forOwner}
        tip={tip}
      />
      <BackupBanner enabled={forOwner} />
      <PaperworkBanner enabled={forOwner} />
      <ReportsBanner enabled={reviewsReports} />
      {view.status === 'live' ? <AgencyStrip agency={view.data.agency} opensSettings={forOwner} /> : null}
      {tip.element}
    </div>
  );
}
