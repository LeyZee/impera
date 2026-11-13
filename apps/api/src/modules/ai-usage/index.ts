/** Public entry point of the `ai-usage` module (ADR 0091). Other modules import this file only. */
import type { AiUsage } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { addCredit, checkCredits, readUsage, type UsageDeps } from './application/usage';
import type { Clock } from './domain/ports';
import type { CapReading } from './domain/usage';
import {
  createPostgresCreditAlerts,
  createPostgresCreditLedger,
  createPostgresUsageReader,
} from './infra/postgres';
import { createAiUsageRoutes, type AiUsageRoutesOptions } from './infra/routes';

export interface AiUsageModule {
  readonly name: 'ai-usage';
  readonly read: () => Promise<AiUsage>;
  /** The hourly check: returns how many `ai_credits_low` it published. */
  readonly jobs: { readonly checkCredits: () => Promise<number> };
  /** `/v1/settings/ai-usage` and its credits, behind the guard given here. */
  readonly routes: (options: AiUsageRoutesOptions) => FastifyPluginAsyncZod;
}

function createAiUsageModule(deps: UsageDeps): AiUsageModule {
  return {
    name: 'ai-usage',
    read: () => readUsage(deps),
    jobs: { checkCredits: () => checkCredits(deps) },
    routes: (options) =>
      createAiUsageRoutes(
        {
          read: () => readUsage(deps),
          add: (body, actor) => addCredit(deps, body, actor),
          remove: (id, actor) => deps.ledger.remove(id, actor),
        },
        options,
      ),
  };
}

export interface AiUsageStartOptions {
  /** The owner role: `llm_calls` spans every creator and the playground, the ledger and the alert are the agency's. */
  readonly adminDb: Database;
  /** The gateway's `health().budget`. */
  readonly cap: () => CapReading;
  readonly timeZone: string;
  readonly usdPerEur: number;
  readonly clock?: Clock;
}

export function startAiUsageModule(options: AiUsageStartOptions): AiUsageModule {
  return createAiUsageModule({
    reader: createPostgresUsageReader(options.adminDb),
    ledger: createPostgresCreditLedger(options.adminDb),
    alerts: createPostgresCreditAlerts(options.adminDb),
    clock: options.clock ?? { now: () => new Date() },
    cap: options.cap,
    timeZone: options.timeZone,
    usdPerEur: options.usdPerEur,
  });
}
