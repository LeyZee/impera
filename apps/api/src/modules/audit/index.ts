/** Public entry point of the `audit` module (EQ-18): the owner's journal of who did what. Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { exportJournal, readJournalPage, type AuditJournalDeps } from './application/journal';
import { decodeAuditCursor, encodeAuditCursor } from './infra/cursor';
import { createPostgresAuditStore } from './infra/postgres';
import { createAuditRoutes, type AuditRoutesOptions } from './infra/routes';

export interface AuditModule {
  readonly name: 'audit';
  /** `/v1/audit` and `/v1/audit.csv`, behind the guard given here. */
  readonly routes: (options: AuditRoutesOptions) => FastifyPluginAsyncZod;
}

export interface AuditStartOptions {
  /** The service connection: `audit_log` is out of RLS, read by the owner through `withAdmin`. */
  readonly adminDb: Database;
}

export function startAuditModule(options: AuditStartOptions): AuditModule {
  const deps: AuditJournalDeps = {
    store: createPostgresAuditStore(options.adminDb),
    cursor: { encode: encodeAuditCursor, decode: decodeAuditCursor },
  };
  return {
    name: 'audit',
    routes: (routes) =>
      createAuditRoutes(
        {
          page: (query) => readJournalPage(deps, query),
          export: (query, actor) => exportJournal(deps, query, actor),
        },
        routes,
      ),
  };
}
