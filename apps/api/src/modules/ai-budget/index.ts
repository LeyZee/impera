/** Public entry point of the `ai-budget` module (choix de Charles 12/11). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { readBudget, writeBudget, type SpendReading } from './application/budget';
import { createCapsCache, type CapsCache } from './application/caps-cache';
import type { CapDefaults } from './domain/budget';
import { createPostgresBudgetStore } from './infra/postgres';
import { createAiBudgetRoutes, type AiBudgetRoutesOptions } from './infra/routes';

export interface AiBudgetModule {
  readonly name: 'ai-budget';
  /** Handed to the gateway (`dailyCapEur`, `trendWatchCapEur`) before it is built. */
  readonly caps: Pick<CapsCache, 'dailyCapEur' | 'trendWatchCapEur'>;
  /** `/v1/settings/ai-budget`, once the gateway that reads the day's spend exists. */
  readonly routes: (
    spend: () => { readonly all: SpendReading; readonly trendWatch: SpendReading },
    options: AiBudgetRoutesOptions,
  ) => FastifyPluginAsyncZod;
}

export interface AiBudgetStartOptions {
  /** The owner role: the agency's row, out of tenancy. */
  readonly adminDb: Database;
  /** The code's values (`DEFAULT_LLM_CONFIG.dailyBudget`), in cents. */
  readonly defaults: CapDefaults;
  readonly onReadError: (error: unknown) => void;
  readonly now?: () => number;
}

/** Reads the owner's caps once before returning, so the gateway's first call uses them; rejects if that read fails. */
export async function startAiBudgetModule(options: AiBudgetStartOptions): Promise<AiBudgetModule> {
  const store = createPostgresBudgetStore(options.adminDb);
  const cache = createCapsCache({
    read: () => store.read(),
    defaults: options.defaults,
    now: options.now ?? Date.now,
    onError: options.onReadError,
  });
  await cache.load();
  return {
    name: 'ai-budget',
    caps: cache,
    routes: (spend, routeOptions) => {
      const deps = { store, cache, defaults: options.defaults, spend };
      return createAiBudgetRoutes(
        { read: () => readBudget(deps), write: (body, actor) => writeBudget(deps, body, actor) },
        routeOptions,
      );
    },
  };
}
