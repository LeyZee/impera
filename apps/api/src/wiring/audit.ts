import { startAuditModule, type AuditModule } from '../modules/audit';

import type { Routes, Shared } from './shared';

export interface WiredAudit {
  readonly module: AuditModule;
  readonly routes: readonly Routes[];
}

/** The owner's journal (EQ-18): read on the service connection, behind the owner's guard. */
export function wireAudit(shared: Shared): WiredAudit {
  const module = startAuditModule({ adminDb: shared.adminDb });
  return { module, routes: [module.routes({ guard: shared.requireRole('owner') })] };
}
