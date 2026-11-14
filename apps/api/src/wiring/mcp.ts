import { createMcpModule, type McpModule } from '../modules/mcp';

import type { Routes, Shared } from './shared';

export interface WiredMcp {
  readonly module: McpModule;
  readonly routes: readonly Routes[];
}

/** The MCP server (ADR 0026, 0105), lot a: the owner's agent accesses; the transport follows. */
export function wireMcp(shared: Shared): WiredMcp {
  const module = createMcpModule({ db: shared.db, adminDb: shared.adminDb });
  return {
    module,
    routes: [module.routes({ guard: shared.requireRole('owner'), recentLogin: shared.recentLogin })],
  };
}
