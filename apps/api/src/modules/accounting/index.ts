import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createPayrollAccounting, type ArchivePdfs } from './application/accounting';
import { createDrizzlePayrollAccountingStore } from './infra/accounting-store';
import type { AccountingReads } from './infra/ports';
import { createAccountingRoutes, type RequireRole } from './infra/routes';

/**
 * Public entry point of the `accounting` module (ADR 0047 § 1): the accountant's exports, the journal and its FEC file,
 * the DAS2 recap and the archive of the PDFs. It writes no table but `audit_log`; it reads pay and the contractors'
 * file, never the other way round.
 */
export interface AccountingModule {
  readonly name: 'accounting';
  /** Mounted under `/v1` by the server: `/payroll/accounting/journal`, `…/das2`, `…/archive`. */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
}

export interface AccountingDeps {
  /** Application role: every export runs under the owner's member context (`withMember`). */
  readonly db: Database;
  /** What the exports read of the planning, from its `index.ts`. */
  readonly reads: AccountingReads;
  /** Each PDF of the archive read back against its fingerprint: pay's, plugged by the composition root. */
  readonly pdfs: ArchivePdfs;
}

export function createAccountingModule(deps: AccountingDeps): AccountingModule {
  return {
    name: 'accounting',
    routes: (requireRole) =>
      createAccountingRoutes(
        createPayrollAccounting(createDrizzlePayrollAccountingStore(deps.db, deps.reads), deps.pdfs),
        requireRole,
      ),
  };
}
