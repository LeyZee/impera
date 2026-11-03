import { JOB_PAYLOADS } from '@nirvana/contracts';

import { secretOrNull } from '../config';
import { createConnectionStatePublisher } from '../connection-state';
import { defineTask } from '../jobs';
import { startProvidersModule, type ProvidersModule } from '../modules/providers';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredProviders {
  readonly module: ProvidersModule;
  readonly tasks: TasksOf<'providers'>;
  readonly routes: readonly Routes[];
}

export async function wireProviders(shared: Shared): Promise<WiredProviders> {
  const { config, adminDb, logger, requireRole, recentLogin } = shared;
  const module = await startProvidersModule({
    adminDb,
    // The `.env.example` placeholder counts as unset: keys stay in memory instead of crashing the start.
    encryptionKeys: secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS) ?? undefined,
    environmentKeys:
      config.NODE_ENV === 'production'
        ? null
        : {
            xai: config.LLM_XAI_API_KEY,
            google: config.LLM_GOOGLE_API_KEY,
            elevenlabs: config.SPEECH_ELEVENLABS_API_KEY,
            mistral: config.LLM_MISTRAL_API_KEY,
            venice: config.LLM_VENICE_API_KEY,
          },
    onLoadError: (error) => {
      logger.warn({ err: error }, 'AI service keys not loaded');
    },
    publishConnectionState: createConnectionStatePublisher(adminDb),
  });
  return {
    module,
    tasks: {
      'providers.check_credentials': defineTask(
        'providers.check_credentials',
        JOB_PAYLOADS['providers.check_credentials'],
        logger,
        async (_payload, { logger: jobLogger }) => {
          const statuses = await module.reverifyAll();
          jobLogger.info(
            { states: statuses.map((s) => `${s.provider}:${s.state}`) },
            'AI service keys checked',
          );
        },
      ),
    },
    routes: [module.routes({ guard: requireRole('owner'), recentLogin })],
  };
}
