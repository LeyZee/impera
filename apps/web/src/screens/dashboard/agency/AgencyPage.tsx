import type { AgencyPeriod } from '@impera/contracts';
import type { JSX } from 'react';

import { AgencyStrip } from '../AgencyStrip';
import { BackupBanner } from '../BackupBanner';
import { CreatorPicker } from '../CreatorPicker';
import { NoCreator } from '../DashboardPage';
import { PaperworkBanner } from '../PaperworkBanner';
import { ReportsBanner } from '../ReportsBanner';
import { useFloatingTip } from '../parts';
import { useDashboard } from '../useDashboard';
import '../dashboard.css';

import { AgencyInsightsPanel } from './AgencyInsights';

/**
 * The Dashboard of the owner and of an active manager, before any creator is chosen (ADR 0078): « Toute l'agence »
 * checked in front of the creators' chips, what waits on the agency, then the agency's figures. A creator's chip opens
 * her Dashboard, her figures first and her agent under them.
 */
export function AgencyPage({
  period,
  onPeriod,
  onCreator,
  forOwner,
  reviewsReports,
  canAddCreator,
}: {
  period: AgencyPeriod;
  onPeriod: (period: AgencyPeriod) => void;
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
      <header className="db-top nv-enter">
        <CreatorPicker onChoose={onCreator} agency={{ selected: true, onChoose: () => undefined }} />
      </header>
      <BackupBanner enabled={forOwner} />
      <PaperworkBanner enabled={forOwner} />
      <ReportsBanner enabled={reviewsReports} />
      {view.status === 'live' ? (
        <AgencyStrip agency={view.data.agency} onAgencyView opensSettings={forOwner} />
      ) : null}
      <AgencyInsightsPanel
        period={period}
        onPeriod={onPeriod}
        creatorId={null}
        onCreator={onCreator}
        canOpenSettings={forOwner}
        tip={tip}
      />
      {tip.element}
    </div>
  );
}
