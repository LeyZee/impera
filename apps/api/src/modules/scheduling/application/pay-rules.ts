import type {
  AccountPayRules,
  AccountPayRulesList,
  CreateAccountPayRulesBodySchema,
  CreatorSummary,
  UserId,
} from '@nirvana/contracts';
import type { z } from 'zod';

import type { Actor, PayRulesStore } from '../domain/ports';

import { toPayRulesDto, toPlanningAccount } from './dto';

/**
 * The pay rules of each platform account (EQ-03, contract `pay-rules.ts`): where pay reads its amounts, in which
 * currency, and what it takes off. Read by the owner and an active manager, added by the owner, never changed.
 */
export interface PayRulesService {
  list(actor: UserId): Promise<AccountPayRulesList>;
  /** `created` is false when the same rules were already recorded (the route answers 200). */
  create(
    actor: Actor,
    body: z.output<typeof CreateAccountPayRulesBodySchema>,
  ): Promise<{ rules: AccountPayRules; created: boolean }>;
}

export function createPayRulesService(
  store: PayRulesStore,
  creators: { list(): Promise<readonly CreatorSummary[]> },
  now: () => Date = () => new Date(),
): PayRulesService {
  return {
    list: async (actor) => {
      const known = await creators.list();
      const read = await store.list(
        actor,
        known.map((creator) => creator.id),
        now(),
      );
      const creatorNames = new Map(known.map((creator) => [creator.id, creator]));
      return {
        currentPeriod: read.currentPeriod,
        accounts: read.accounts
          .map(({ account, rules }) => ({
            account: toPlanningAccount(account, creatorNames),
            rules: rules.map(toPayRulesDto),
          }))
          .toSorted(
            (a, b) =>
              a.account.creatorName.localeCompare(b.account.creatorName, 'fr') ||
              a.account.handle.localeCompare(b.account.handle, 'fr') ||
              a.account.id.localeCompare(b.account.id),
          ),
      };
    },

    create: async (actor, body) => {
      const { rules, created } = await store.create(actor, body, now());
      return { rules: toPayRulesDto(rules), created };
    },
  };
}
