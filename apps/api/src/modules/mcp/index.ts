/** Public entry point of the `mcp` module (ADR 0026, amended by ADR 0105). Other files import this one only. */
import type { Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { contentTools } from './application/content-tools';
import { createDispatcher, whoami } from './application/dispatch';
import { createGrants } from './application/grants';
import { creatorTools, fanTools } from './application/read-tools';
import { statusTools } from './application/status-tools';
import { teamTools } from './application/team-tools';
import type { ActorView } from './domain/access';
import type {
  AiUsageReader,
  ContentReads,
  CreatorReader,
  FanReader,
  GrantRecord,
  ShiftReader,
  TeamImportReader,
} from './domain/ports';
import { createDrizzleGrantStore } from './infra/db/grant-store';
import { createDrizzleJournal } from './infra/db/journal';
import { createMcpRoutes } from './infra/http/routes';
import { createMcpTransport } from './infra/http/transport';
import { hashOfToken, mintToken } from './infra/token';

export interface McpModule {
  readonly name: 'mcp';
  /** `routes({ guard, recentLogin })`, mounted under `/v1`: `/settings/mcp-grants`. */
  routes(options: {
    readonly guard: preValidationAsyncHookHandler;
    readonly recentLogin: preValidationAsyncHookHandler;
  }): FastifyPluginAsyncZod;
  /**
   * `transport()`, mounted under `/v1`: `POST /mcp`, the MCP server itself (ADR 0026 § 2), its own door (a token,
   * never the CRM's session), its own rule of `Origin`.
   */
  transport(): FastifyPluginAsyncZod;
  /** The live access a token names, its last use stamped; `null` otherwise. */
  grantOfToken(token: string): Promise<GrantRecord | null>;
}

export type { ActorView } from './domain/access';

export interface McpDeps {
  /** Application role: the owner's accesses under his policies. */
  readonly db: Database;
  /** Service role (ADR 0087): reads the access of a token, writes nothing. */
  readonly adminDb: Database;
  /**
   * The person an access acts for, read at every call by the same function as a session (`resolveActor`, ADR 0026
   * § 4): the module computes no right of its own. `null` for an account gone, a member who left.
   */
  readonly actorOf: (userId: string) => Promise<ActorView | null>;
  /** The persona module's directory (`persona.creators`), for `creators_list` and `creator_get`. */
  readonly creators: CreatorReader;
  /** The fans module's reads (`getFan`, `activeFacts`, `flags`, `card`), for `fan_get` and `fan_card_get`. */
  readonly fans: FanReader;
  /** Her drops and scripts (`content-drops`, `scripts`), for `drops_list`, `scripts_list` and `script_steps_get`. */
  readonly content: ContentReads;
  /** The planning (`scheduling.reads.shifts`, `reads.onShiftNow`), for `shifts_list` and `on_shift_now`. */
  readonly shifts: ShiftReader;
  /** The team imported from a platform (`connectors.reads.teamImport`), for `team_import_list`. */
  readonly teamImport: TeamImportReader;
  /** The AI spend (`ai-usage`), for `ai_usage_get`, the owner's alone. */
  readonly aiUsage: AiUsageReader;
}

export function createMcpModule(deps: McpDeps): McpModule {
  const grants = createGrants({
    store: createDrizzleGrantStore(deps.db, deps.adminDb),
    mint: mintToken,
    hashOf: hashOfToken,
    now: () => new Date(),
  });
  const journal = createDrizzleJournal(deps.db);
  return {
    name: 'mcp',
    routes: (options) => createMcpRoutes(grants, options),
    transport: () =>
      createMcpTransport({
        grantOfToken: (token) => grants.grantOfToken(token),
        actorOf: deps.actorOf,
        dispatcher: (spendRead) =>
          createDispatcher({
            journal,
            spendRead,
            tools: {
              whoami,
              ...creatorTools(deps.creators),
              ...fanTools(deps.fans),
              ...contentTools(deps.content),
              ...teamTools(deps.shifts, deps.teamImport),
              ...statusTools(deps.aiUsage),
            },
          }),
        allowedOrigins: [],
      }),
    grantOfToken: (token) => grants.grantOfToken(token),
  };
}
