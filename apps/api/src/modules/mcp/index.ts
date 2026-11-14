/** Public entry point of the `mcp` module (ADR 0026, amended by ADR 0105). Other files import this one only. */
import type { Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createGrants } from './application/grants';
import type { GrantRecord } from './domain/ports';
import { createDrizzleGrantStore } from './infra/db/grant-store';
import { createMcpRoutes } from './infra/http/routes';
import { hashOfToken, mintToken } from './infra/token';

export interface McpModule {
  readonly name: 'mcp';
  /** `routes({ guard, recentLogin })`, mounted under `/v1`: `/settings/mcp-grants`. */
  routes(options: {
    readonly guard: preValidationAsyncHookHandler;
    readonly recentLogin: preValidationAsyncHookHandler;
  }): FastifyPluginAsyncZod;
  /** The live access a token names, its last use stamped; `null` otherwise. The transport's door (lot a, next). */
  grantOfToken(token: string): Promise<GrantRecord | null>;
}

export interface McpDeps {
  /** Application role: the owner's accesses under his policies. */
  readonly db: Database;
  /** Service role (ADR 0087): reads the access of a token, writes nothing. */
  readonly adminDb: Database;
}

export function createMcpModule(deps: McpDeps): McpModule {
  const grants = createGrants({
    store: createDrizzleGrantStore(deps.db, deps.adminDb),
    mint: mintToken,
    hashOf: hashOfToken,
    now: () => new Date(),
  });
  return {
    name: 'mcp',
    routes: (options) => createMcpRoutes(grants, options),
    grantOfToken: (token) => grants.grantOfToken(token),
  };
}
