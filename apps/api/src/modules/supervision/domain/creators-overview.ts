import {
  calendarDayAt,
  payPeriodAt,
  type CreatorId,
  type CreatorOverview,
  type CreatorOverviewRequests,
  type TeamMemberId,
} from '@impera/contracts';

import { modeOf } from './dashboard';
import type { CreatorOverviewFacts, OnShiftReading, RevealSalesReading } from './dashboard-ports';
import type { UsdRate } from './fan-ranking';
import { revealSalesPanel } from './reveal-sales';

/**
 * The card of each creator in the list of Créatrices (« ok liste-créatrices », Charles, 06/11): her agent's mode, the
 * sales of her fortnight, who is on shift on her now and what the agency waits for from her. Pure: the route reads,
 * this puts it together. A reader whose scope is his own gets her mode alone (ADR 0043 § 7).
 */

/** Her fortnight, as pay cuts it: the 1st or the 16th of her month, up to today, both in her zone. */
export function fortnightDays(now: Date, timeZone: string): { readonly from: string; readonly to: string } {
  return { from: payPeriodAt(now, timeZone), to: calendarDayAt(now, timeZone) };
}

export function creatorOverview(input: {
  readonly creatorId: CreatorId;
  readonly facts: CreatorOverviewFacts;
  readonly now: Date;
  readonly sales: RevealSalesReading | undefined;
  readonly rate: UsdRate | null;
  readonly onShift: readonly OnShiftReading[];
}): CreatorOverview {
  const { creatorId, facts, now, sales, rate, onShift } = input;
  const mode = modeOf(facts);
  if (facts.scope === 'self') return { creatorId, mode, sales: null, onShift: null, requests: null };
  const panel = sales === undefined ? null : revealSalesPanel({ ...sales, rate, names: null });
  return {
    creatorId,
    mode,
    sales:
      panel === null
        ? null
        : {
            from: panel.from,
            to: panel.to,
            sales: panel.totals.sales,
            refunds: panel.totals.refunds,
            revenueMinor: panel.totals.revenueMinor,
            usdLeftOut: panel.usd.seen && panel.usd.rate === null,
          },
    onShift: shiftsOf(onShift, facts.names),
    requests: requestsOf(facts.requests, calendarDayAt(now, facts.timezone)),
  };
}

/** One line per member, the one whose shift ends last kept; a member the team does not name is left out. */
function shiftsOf(
  onShift: readonly OnShiftReading[],
  names: ReadonlyMap<string, string>,
): NonNullable<CreatorOverview['onShift']> {
  const latest = new Map<TeamMemberId, Date>();
  for (const shift of onShift) {
    const seen = latest.get(shift.memberId);
    if (seen === undefined || shift.endsAt > seen) latest.set(shift.memberId, shift.endsAt);
  }
  return [...latest]
    .flatMap(([memberId, endsAt]) => {
      const name = names.get(memberId);
      return name === undefined ? [] : [{ memberId, name, endsAt: endsAt.toISOString() }];
    })
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt) || a.name.localeCompare(b.name, 'fr'));
}

function requestsOf(requests: CreatorOverviewFacts['requests'], today: string): CreatorOverviewRequests {
  const [first] = requests.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn));
  return {
    open: requests.length,
    next: first === undefined ? null : { ...first, late: first.dueOn < today },
  };
}
