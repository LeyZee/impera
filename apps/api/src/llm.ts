import {
  createInMemoryCallLog,
  createLlmGateway,
  createModelResolver,
  createTranscriberResolver,
  DEFAULT_LLM_CONFIG,
  type ApiKeySource,
  type BudgetEvent,
  type LlmCallLog,
  type LlmGateway,
  type LlmGatewayDeps,
  type ProviderBaseUrls,
  type ProviderId,
} from '@impera/llm';

import type { Logger } from './logger';

/** What every gateway of the app shares: keys, one call journal (so the daily cap is one), the listeners. */
type AppLlmDeps = Pick<LlmGatewayDeps, 'credentials' | 'log' | 'onKeyRefused' | 'onBudget'>;

export interface AppLlm {
  readonly gateway: LlmGateway;
  readonly deps: AppLlmDeps;
}

export interface AppLlmOptions {
  /** The keys saved in Réglages > Modèles IA, the environment's in development (ADR 0016). */
  readonly credentials: ApiKeySource;
  readonly reportRefusedKey: (
    provider: ProviderId,
    kind: 'unauthorized' | 'missing_permission',
  ) => Promise<void>;
  /** Writes the crossing to the outbox (Telegram alerts it); best effort, the cap is enforced by the gateway. */
  readonly publishBudget?: (event: BudgetEvent) => Promise<void>;
  readonly logger: Logger;
  /** The llm_calls journal (`createPersistentCallLog`); in memory when absent (tests, terminal). */
  readonly log?: LlmCallLog;
  /** The recette sandbox's fake world (ADR 0075); each provider's own API when absent. */
  readonly baseUrls?: ProviderBaseUrls;
}

/** The one LLM gateway of the app (ADR 0009), built once by the composition root and handed to the modules. */
export function createAppLlm(options: AppLlmOptions): AppLlm {
  const { logger } = options;
  const deps: AppLlmDeps = {
    credentials: options.credentials,
    log: options.log ?? createInMemoryCallLog(),
    onKeyRefused: ({ provider, status }) => {
      void options
        .reportRefusedKey(provider, status === 401 ? 'unauthorized' : 'missing_permission')
        .catch((err: unknown) => {
          logger.warn({ err, provider }, 'key refusal not recorded');
        });
    },
    onBudget: (event) => {
      const { kind, status } = event;
      void options.publishBudget?.(event).catch((err: unknown) => {
        logger.warn({ err, kind }, 'budget crossing not written to the outbox');
      });
      logger.warn(
        { kind, spentEur: status.spentEur, capEur: status.capEur, day: status.day },
        kind === 'reached'
          ? 'daily AI cap reached: no more generation until midnight'
          : 'daily AI cap at 80 %',
      );
    },
  };
  const gateway = createLlmGateway({
    ...deps,
    config: DEFAULT_LLM_CONFIG,
    resolveModel: createModelResolver(deps.credentials, options.baseUrls),
    resolveTranscriber: createTranscriberResolver(deps.credentials, options.baseUrls),
  });
  return { gateway, deps };
}
