import { JOB_PAYLOADS } from '@impera/contracts';
import { DEFAULT_LLM_CONFIG } from '@impera/llm';

import { defineTask } from '../jobs';
import type { AppLlm } from '../llm';
import { startAiUsageModule, type AiUsageModule } from '../modules/ai-usage';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredAiUsage {
  readonly module: AiUsageModule;
  readonly tasks: TasksOf<'ai_usage'>;
  readonly routes: readonly Routes[];
}

/** Réglages › Consommation IA (ADR 0091): the journal of the app's one gateway, and the credits ledger. */
export function wireAiUsage(shared: Shared, llm: AppLlm): WiredAiUsage {
  const { adminDb, logger, requireRole } = shared;
  const { timeZone, usdPerEur } = DEFAULT_LLM_CONFIG.dailyBudget;
  const module = startAiUsageModule({
    adminDb,
    cap: () => llm.gateway.health().budget,
    timeZone,
    usdPerEur,
  });
  return {
    module,
    tasks: {
      'ai_usage.check_credits': defineTask(
        'ai_usage.check_credits',
        JOB_PAYLOADS['ai_usage.check_credits'],
        logger,
        async (_payload, context) => {
          const published = await module.jobs.checkCredits();
          if (published > 0) context.logger.warn({ published }, 'AI credits running low, owner alerted');
        },
      ),
    },
    routes: [module.routes({ guard: requireRole('owner') })],
  };
}
