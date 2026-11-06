import type { AgencyPeriod } from '@impera/contracts';
import type { JSX } from 'react';

import { BackupBanner } from '../BackupBanner';
import { CreatorPicker } from '../CreatorPicker';
import { PaperworkBanner } from '../PaperworkBanner';
import { ReportsBanner } from '../ReportsBanner';
import { useFloatingTip } from '../parts';
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
}: {
  period: AgencyPeriod;
  onPeriod: (period: AgencyPeriod) => void;
  onCreator: (creatorId: string) => void;
  /** The owner also reads the daily export and the invoices' paperwork, and links the registers. */
  forOwner: boolean;
  /** The account reviews the team's reports (ADR 0073). */
  reviewsReports: boolean;
}): JSX.Element {
  const tip = useFloatingTip();
  return (
    <div className="db">
      <header className="db-top nv-enter">
        <CreatorPicker onChoose={onCreator} agency={{ selected: true, onChoose: () => undefined }} />
      </header>
      <BackupBanner enabled={forOwner} />
      <PaperworkBanner enabled={forOwner} />
      <ReportsBanner enabled={reviewsReports} />
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
