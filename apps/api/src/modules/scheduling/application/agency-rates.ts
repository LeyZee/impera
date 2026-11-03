import {
  agencyRateFor,
  type CreateCreatorAgencyRateBodySchema,
  type CreatorAgencyRate,
  type CreatorAgencyRateList,
  type CreatorId,
  type CreatorSummary,
  type UserId,
} from '@impera/contracts';
import type { z } from 'zod';

import { CreatorNotFound } from '../domain/errors';
import type { Actor, AgencyRatesStore } from '../domain/ports';

import { toAgencyRateDto } from './dto';

/**
 * The agency's percentage of each creator (CR-04, contract `agency-rates.ts`, ADR 0042 § 6): read and added by the
 * owner alone, from a day on, never changed. No value is ever made up: a creator without one has `current: null`.
 */
export interface AgencyRatesService {
  list(actor: UserId, creatorId: CreatorId): Promise<CreatorAgencyRateList>;
  /** `created` is false when the same percentage was already recorded (the route answers 200). */
  create(
    actor: Actor,
    creatorId: CreatorId,
    body: z.output<typeof CreateCreatorAgencyRateBodySchema>,
  ): Promise<{ rate: CreatorAgencyRate; created: boolean }>;
}

export function createAgencyRatesService(
  store: AgencyRatesStore,
  creators: { list(): Promise<readonly CreatorSummary[]> },
  now: () => Date = () => new Date(),
): AgencyRatesService {
  const assertCreatorExists = async (creatorId: CreatorId): Promise<void> => {
    if (!(await creators.list()).some((creator) => creator.id === creatorId)) throw new CreatorNotFound();
  };

  return {
    list: async (actor, creatorId) => {
      await assertCreatorExists(creatorId);
      const { today, rates } = await store.list(actor, creatorId, now());
      const current = agencyRateFor(rates, today);
      return {
        today,
        current: current === null ? null : toAgencyRateDto(current),
        rates: rates.map(toAgencyRateDto),
      };
    },

    create: async (actor, creatorId, body) => {
      await assertCreatorExists(creatorId);
      const { rate, created } = await store.create(actor, creatorId, body, now());
      return { rate: toAgencyRateDto(rate), created };
    },
  };
}
