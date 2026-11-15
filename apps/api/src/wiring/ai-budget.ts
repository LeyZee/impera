import { DEFAULT_LLM_CONFIG } from '@impera/llm';

import type { AppLlm } from '../llm';
import { startAiBudgetModule, type AiBudgetModule } from '../modules/ai-budget';

import type { Routes, Shared } from './shared';

export interface WiredAiBudget {
  readonly module: AiBudgetModule;
  /** The routes read the gateway's spend: built once the gateway exists. */
  readonly routes: (llm: AppLlm) => readonly Routes[];
}

/** Réglages › Modèles IA › Budget IA (choix de Charles 12/11): the caps the gateway reads, set by the owner. */
export async function wireAiBudget(shared: Shared): Promise<WiredAiBudget> {
  const { adminDb, logger, requireRole, recentLogin } = shared;
  const { capEur, trendWatchCapEur } = DEFAULT_LLM_CONFIG.dailyBudget;
  const module = await startAiBudgetModule({
    adminDb,
    defaults: {
      dailyCapMinor: Math.round(capEur * 100),
      trendWatchCapMinor: Math.round(trendWatchCapEur * 100),
    },
    onReadError: (error) => {
      logger.warn({ err: error }, 'AI budget not reloaded, the last value known stays');
    },
  });
  return {
    module,
    routes: (llm) => [
      module.routes(
        () => {
          const { budget, trendWatchBudget } = llm.gateway.health();
          return { all: budget, trendWatch: trendWatchBudget };
        },
        { guard: requireRole('owner'), recentLogin },
      ),
    ],
  };
}
