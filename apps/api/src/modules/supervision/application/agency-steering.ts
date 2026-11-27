import { calendarDayAt, type AgencySteering, type CreatorId } from '@impera/contracts';

import {
  agencySteering,
  steeringRange,
  type AgencySteeringReader,
  type SteeringCreatorRead,
} from '../domain/agency-steering';
import type { UsdRateView } from '../domain/dashboard-ports';

import type { AgencyReader } from './agency-reads';

export interface AgencySteeringDeps {
  readonly steering: AgencySteeringReader;
  readonly usdRate: UsdRateView;
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  readonly agencyTimeZone: string;
  readonly now?: () => Date;
}

export type SteeringAnswer =
  | { readonly kind: 'creator_out_of_scope' }
  | { readonly kind: 'team_out_of_scope' }
  | { readonly kind: 'read'; readonly steering: AgencySteering };

/** The hour of `at` in `timeZone`, its minutes as a fraction. */
function hourAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return get('hour') + get('minute') / 60;
}

/**
 * The agency's steering as a person reads it: the same rule as the agency's figures (ADR 0078 § 1, ADR 0043 § 7),
 * the owner and an active manager only, a manager on the creators of his list.
 */
export async function readAgencySteering(
  deps: AgencySteeringDeps,
  reader: AgencyReader,
  creatorId?: CreatorId,
): Promise<SteeringAnswer> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return { kind: 'team_out_of_scope' };
  const owner = reader.role === 'owner';
  const every = await deps.allCreatorIds();
  let chosen: readonly CreatorId[];
  if (creatorId !== undefined) {
    if (!owner && !reader.creatorIds.includes(creatorId)) return { kind: 'creator_out_of_scope' };
    chosen = [creatorId];
  } else {
    chosen = owner ? every : every.filter((id) => reader.creatorIds.includes(id));
  }
  const now = (deps.now ?? (() => new Date()))();
  const range = steeringRange(calendarDayAt(now, deps.agencyTimeZone));
  const reads: SteeringCreatorRead[] = [];
  let outOfScope = 0;
  for (const id of chosen) {
    const answer = await deps.steering.read(id, reader.userId, range);
    if (answer.kind === 'out_of_scope') outOfScope += 1;
    if (answer.kind === 'read') reads.push(answer.read);
  }
  if (!owner && (chosen.length === 0 || outOfScope === chosen.length)) return { kind: 'team_out_of_scope' };
  const rate = await deps.usdRate.latest(reader.userId);
  return {
    kind: 'read',
    steering: agencySteering({
      creators: reads,
      range,
      rate,
      timeZone: deps.agencyTimeZone,
      nowHour: hourAt(now, deps.agencyTimeZone),
    }),
  };
}
