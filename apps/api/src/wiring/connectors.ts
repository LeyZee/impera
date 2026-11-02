import { JOB_PAYLOADS } from '@nirvana/contracts';
import { parseEncryptionKeys } from '@nirvana/db';

import { secretOrNull } from '../config';
import { defineTask } from '../jobs';
import {
  createConnectorsModule,
  type ConnectorRegistry,
  type ConnectorsDeps,
  type ConnectorsModule,
} from '../modules/connectors';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredConnectors {
  readonly module: ConnectorsModule;
  readonly tasks: TasksOf<'connector'>;
  readonly routes: readonly Routes[];
}

export function wireConnectors(
  shared: Shared,
  deps: {
    /** Called by the jobs only, once `conversations` exists (the two modules need each other's port). */
    readonly ingest: ConnectorsDeps['ingest'];
    /** Reveal's adapter arrives with phase 1 (ADR 0008); until then no account is polled. */
    readonly registry: ConnectorRegistry;
  },
): WiredConnectors {
  const { config, db, adminDb, logger } = shared;
  const sessionKeys = secretOrNull(config.SESSION_ENCRYPTION_KEYS);
  const module = createConnectorsModule({
    db,
    adminDb,
    ingest: deps.ingest,
    registry: deps.registry,
    sessionKeys: sessionKeys === null ? null : parseEncryptionKeys(sessionKeys, 'SESSION_ENCRYPTION_KEYS'),
    deviceToken: secretOrNull(config.EXTENSION_DEVICE_TOKEN),
  });
  return {
    module,
    tasks: {
      'connector.dispatch': defineTask(
        'connector.dispatch',
        JOB_PAYLOADS['connector.dispatch'],
        logger,
        (_payload, context) => module.jobs.dispatch(context.logger),
      ),
      'connector.poll': defineTask(
        'connector.poll',
        JOB_PAYLOADS['connector.poll'],
        logger,
        (payload, context) => module.jobs.poll(payload, context.logger),
      ),
      'connector.reconcile': defineTask(
        'connector.reconcile',
        JOB_PAYLOADS['connector.reconcile'],
        logger,
        (payload, context) => module.jobs.reconcile(payload, context.logger),
      ),
    },
    routes: [module.routes],
  };
}
