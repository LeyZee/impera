import { limitKeyOf } from '@impera/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { McpDispatcher } from '../../application/dispatch';
import type { ActorView } from '../../domain/access';
import { MCP_CATALOGUE_VERSION } from '../../domain/catalogue';
import type { GrantRecord } from '../../domain/ports';

/** Requests to `/v1/mcp` from one address in a minute, good or bad (ADR 0026 § 8). */
const MCP_PER_ADDRESS_PER_MINUTE = 120;
/** Refused tokens from one address in a minute before it is refused outright, its counter shared (`security.md` §6). */
export const MCP_FAILURES_PER_ADDRESS_PER_MINUTE = 10;
/** Reads of one access in a minute (ADR 0026 § 8). */
const MCP_READS_PER_ACCESS_PER_MINUTE = 60;
/** A JSON-RPC message of the lot a carries a tool's name and a few identifiers: far under this. */
const MCP_BODY_LIMIT_BYTES = 64 * 1024;

export interface McpTransportOptions {
  /** The live access a token names, `null` for anything else (its form, its fingerprint, revoked, expired). */
  readonly grantOfToken: (token: string) => Promise<GrantRecord | null>;
  /** The person an access acts for, read now as a session would be (`resolveActor`); `null` for an account gone. */
  readonly actorOf: (userId: string) => Promise<ActorView | null>;
  readonly dispatcher: (spendRead: (grant: GrantRecord) => Promise<boolean>) => McpDispatcher;
  /**
   * Origins a browser may call from (ADR 0026 § 2, against DNS rebinding): an absent `Origin` is a client out of a
   * browser and passes; a present one must be here. Empty in lot a: no page calls the MCP server.
   */
  readonly allowedOrigins: readonly string[];
}

/** One answer for every failure of the door, whatever failed: it tells nothing of the token or of the person. */
const UNAUTHORIZED = {
  jsonrpc: '2.0',
  error: { code: -32001, message: 'Accès refusé' },
  id: null,
} as const;

const BEARER = /^Bearer ([^\s]+)$/u;

/** The JSON-RPC error of a refusal: its kind, never a datum (`McpCallRefusal`). */
const refusalResult = (refusal: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: `Refusé : ${refusal}` }],
  structuredContent: { refusal },
});

/**
 * `POST /v1/mcp` (ADR 0026 § 2, ADR 0105): the MCP server, streamable HTTP without state, by the SDK's transport on Web
 * standards (no server of its own, no session). The door: `Authorization: Bearer` only (never a parameter of the URL,
 * never the CRM's cookie), the token's form then its fingerprint, the person read again; every failure the same 401,
 * counted by address. Then the SDK answers `initialize`, `tools/list` and `tools/call` through the dispatcher.
 */
export function createMcpTransport(options: McpTransportOptions): FastifyPluginAsyncZod {
  return (app) => {
    const allowed = new Set(options.allowedOrigins);
    const grants = new WeakMap<FastifyRequest, string>();
    const failures = app.createRateLimit({
      max: MCP_FAILURES_PER_ADDRESS_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (request) => `mcp-failure:${limitKeyOf(request.ip)}`,
      skipOnError: false,
    });
    const reads = app.createRateLimit({
      max: MCP_READS_PER_ACCESS_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (request) => `mcp-read:${grants.get(request) ?? '-'}`,
      skipOnError: false,
    });

    const refuseDoor = async (request: FastifyRequest, reply: FastifyReply) => {
      const attempt = await failures(request);
      if (!attempt.isAllowed && attempt.isExceeded) {
        return reply
          .code(429)
          .header('retry-after', attempt.ttlInSeconds)
          .send({ ...UNAUTHORIZED, error: { code: -32000, message: 'Trop de tentatives' } });
      }
      return reply.code(401).header('www-authenticate', 'Bearer').send(UNAUTHORIZED);
    };

    const notAllowed = (_request: FastifyRequest, reply: FastifyReply) =>
      reply
        .code(405)
        .header('allow', 'POST')
        .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non permise' }, id: null });

    const config = {
      originCheck: false,
      rateLimit: { max: MCP_PER_ADDRESS_PER_MINUTE, timeWindow: '1 minute' },
    };
    // Without state, nothing to stream back nor to close (ADR 0026 § 2: no sending at the server's initiative).
    app.get('/mcp', { config }, notAllowed);
    app.delete('/mcp', { config }, notAllowed);

    app.post(
      '/mcp',
      { config, bodyLimit: MCP_BODY_LIMIT_BYTES, schema: { body: z.unknown() } },
      async (request, reply) => {
        const origin = request.headers.origin;
        if (origin !== undefined && !allowed.has(origin)) {
          return reply
            .code(403)
            .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Origine non autorisée' }, id: null });
        }
        // The token in the URL would land in logs and histories: no parameter at all is taken here.
        if (request.url.includes('?')) return refuseDoor(request, reply);
        const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
        const grant = bearer === undefined ? null : await options.grantOfToken(bearer);
        if (grant === null) return refuseDoor(request, reply);
        const actor = await options.actorOf(grant.userId);
        if (actor === null) return refuseDoor(request, reply);
        grants.set(request, grant.id);

        const dispatcher = options.dispatcher(async () => {
          const attempt = await reads(request);
          return attempt.isAllowed || !attempt.isExceeded;
        });
        // The high-level server for the protocol, its tools answered by the dispatcher (never `registerTool`): the
        // catalogue, its rule and its journal stay ours.
        const server = new McpServer(
          { name: 'impera-mcp', version: MCP_CATALOGUE_VERSION },
          { capabilities: { tools: {} } },
        );
        server.server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: dispatcher.list(grant).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: { type: 'object' as const, ...z.toJSONSchema(tool.input, { io: 'input' }) },
          })),
        }));
        server.server.setRequestHandler(CallToolRequestSchema, async (call) => {
          try {
            const result = await dispatcher.call({
              grant,
              actor,
              name: call.params.name,
              args: call.params.arguments,
              requestId: request.id,
              ip: request.ip,
            });
            if (!result.ok) return refusalResult(result.refusal);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result.value) }],
              structuredContent: z.record(z.string(), z.unknown()).parse(result.value),
            };
          } catch (error) {
            // Logged here with the request; the agent gets no message of ours, nor of a module's.
            request.log.error({ err: error }, 'mcp tool call failed');
            throw new McpError(ErrorCode.InternalError, 'Erreur interne');
          }
        });

        // No `sessionIdGenerator`: without state, no session id is given nor asked for.
        const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
        try {
          await server.connect(transport);
          const headers = new Headers();
          for (const name of ['accept', 'content-type', 'mcp-protocol-version']) {
            const value = request.headers[name];
            if (typeof value === 'string') headers.set(name, value);
          }
          // Neither the token nor a cookie goes further than the door.
          const response = await transport.handleRequest(
            new Request(`http://mcp.local${request.url}`, { method: 'POST', headers }),
            { parsedBody: request.body },
          );
          reply.code(response.status);
          response.headers.forEach((value, name) => {
            void reply.header(name, value);
          });
          void reply.header('cache-control', 'no-store');
          const text = await response.text();
          return await reply.send(text === '' ? undefined : text);
        } finally {
          await transport.close();
          await server.close();
        }
      },
    );
    return Promise.resolve();
  };
}
