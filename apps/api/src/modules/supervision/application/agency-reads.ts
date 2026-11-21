import type { AgencyInsights, AgencySpanQuery, CreatorId, UserId, UserRole } from '@impera/contracts';

import { agencyInsights, agencySpan, type AgencyCreatorRead } from '../domain/agency-insights';
import type { AgencyFiguresStore, UsdRateView } from '../domain/dashboard-ports';

/** Who reads the agency's figures: his role and the creators of his own list (`creatorIds`, the session's). */
export interface AgencyReader {
  readonly userId: UserId;
  readonly role: UserRole;
  readonly creatorIds: readonly CreatorId[];
}

export interface AgencyReadsDeps {
  readonly agency: AgencyFiguresStore;
  readonly usdRate: UsdRateView;
  /** Every creator, in the agency's order (Créatrices). */
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  /** The zone the agency's days are counted in: the platforms' (Reveal's, Europe/Paris). */
  readonly agencyTimeZone: string;
  readonly now?: () => Date;
}

/**
 * The agency's figures as a person reads them (ADR 0078 § 1): `creator_out_of_scope` for one creator not his,
 * `team_out_of_scope` when nothing was read with the team's scope (ADR 0043 § 7). The one rule of `GET
 * /v1/dashboard/agency` and of the MCP's `stats_get`: only the owner and an active manager read them, and a manager
 * only the creators of his list.
 */
export type AgencyAnswer =
  | { readonly kind: 'creator_out_of_scope' }
  | { readonly kind: 'team_out_of_scope' }
  /** The comparison asked does not end before the period (ADR 0146 § 3). */
  | { readonly kind: 'comparison_not_before' }
  | { readonly kind: 'read'; readonly insights: AgencyInsights };

export async function readAgencyInsights(
  deps: AgencyReadsDeps,
  reader: AgencyReader,
  asked: AgencySpanQuery,
  creatorId?: CreatorId,
): Promise<AgencyAnswer> {
  // A creator never reads them (ADR 0078 § 1); the route's guard says it first, the MCP has none.
  if (reader.role !== 'owner' && reader.role !== 'operator') return { kind: 'team_out_of_scope' };
  const owner = reader.role === 'owner';
  const every = await deps.allCreatorIds();
  let chosen: readonly CreatorId[];
  if (creatorId !== undefined) {
    if (!owner && !reader.creatorIds.includes(creatorId)) return { kind: 'creator_out_of_scope' };
    chosen = [creatorId];
  } else {
    // The agency's order (Créatrices), restricted to the account's own list for anyone but the owner.
    chosen = owner ? every : every.filter((id) => reader.creatorIds.includes(id));
  }
  const now = (deps.now ?? (() => new Date()))();
  const days = agencySpan(asked, now, deps.agencyTimeZone);
  if (days === null) return { kind: 'comparison_not_before' };
  const { range, span } = days;
  // One tenant transaction per creator (RLS), one after the other: a read holds one connection of the pool.
  const reads: AgencyCreatorRead[] = [];
  let outOfScope = 0;
  for (const id of chosen) {
    // A calendar month reads its revenue objectives too (ADR 0092 § 6).
    const answer = await deps.agency.read(
      id,
      reader.userId,
      range,
      span.unit === 'month' ? range.from : null,
    );
    if (answer.kind === 'out_of_scope') outOfScope += 1;
    if (answer.kind === 'read') reads.push(answer.read);
  }
  // Nothing read with the team's scope: these figures are not his (ADR 0043 § 7).
  if (!owner && (chosen.length === 0 || outOfScope === chosen.length)) return { kind: 'team_out_of_scope' };
  const [first] = reads;
  const [names, rate] = await Promise.all([
    first === undefined ? new Map<string, string>() : deps.agency.memberNames(first.creatorId, reader.userId),
    deps.usdRate.latest(reader.userId),
  ]);
  return {
    kind: 'read',
    insights: agencyInsights({
      period: asked.kind === 'rolling' ? asked.period : null,
      span,
      range,
      creators: reads,
      names,
      rate,
      timeZone: deps.agencyTimeZone,
    }),
  };
}
