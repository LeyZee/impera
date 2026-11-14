import { McpWhoamiSchema, type McpCallRefusal, type McpCapability, type McpWhoami } from '@impera/contracts';
import { z } from 'zod';

import { decideCall, type ActorView } from '../domain/access';
import { MCP_CATALOGUE_VERSION, toolNamed, type McpToolSpec } from '../domain/catalogue';
import type { GrantRecord, McpJournal } from '../domain/ports';

/** What a served tool is given: the access, the person as read for this call, the creator it is confined to. */
export interface ToolContext {
  readonly grant: GrantRecord;
  readonly actor: ActorView;
  readonly creatorId: string | null;
}

/**
 * A tool of the catalogue as served: its input (Zod, strict), what it says to the agent, and what it does. It calls
 * only what a module exports by its `index.ts` (ADR 0026 § 1), never the base.
 */
export interface ServedTool {
  readonly description: string;
  readonly input: z.ZodType<Record<string, unknown>>;
  /** An object: it is the call's `structuredContent`, which MCP wants as one. */
  readonly output: z.ZodType<Record<string, unknown>>;
  run(context: ToolContext, input: Record<string, unknown>): Promise<unknown>;
  /**
   * The identifiers the call touches, for its line in the journal (ADR 0026 § 8): ids only, never a name or a text.
   * Read from its validated input; none for a tool on the access or the agency.
   */
  subject?(input: Record<string, unknown>): Readonly<Record<string, string>>;
}

/** A tool as `tools/list` gives it. */
interface ListedTool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType;
}

interface McpCall {
  readonly grant: GrantRecord;
  readonly actor: ActorView;
  readonly name: string;
  readonly args: unknown;
  readonly requestId: string;
  readonly ip: string;
}

type McpCallResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly refusal: McpCallRefusal };

export interface McpDispatcher {
  /** The served tools this access holds the capability of; the call still decides on everything else. */
  list(grant: GrantRecord, actor: ActorView): readonly ListedTool[];
  call(call: McpCall): Promise<McpCallResult>;
}

export interface DispatcherDeps {
  readonly journal: McpJournal;
  /** Spends one read of the access (ADR 0026 § 8); `false` once its minute is spent. */
  readonly spendRead: (grant: GrantRecord) => Promise<boolean>;
  /** The tools served so far, by name; a name of the catalogue not here is `tool_unknown`. */
  readonly tools: Readonly<Record<string, ServedTool>>;
}

/** The creator a call names, when its input has one; the rule (`decideCall`) decides whether it may. */
const namedCreatorOf = (input: Record<string, unknown>): string | undefined =>
  typeof input['creatorId'] === 'string' ? input['creatorId'] : undefined;

const holds = (grant: GrantRecord, capability: McpCapability | null): boolean =>
  capability === null || grant.capabilities.includes(capability);

/**
 * The dispatcher of the MCP server (ADR 0026 § 4 and § 8): a name of the catalogue that is served, arguments that
 * validate, the rule of access on the person as read for this call, the read limit of the access, then the tool. Every
 * call, refused or not, has its line in the journal before anything is given back: a call that cannot be written down
 * gives nothing.
 */
export function createDispatcher(deps: DispatcherDeps): McpDispatcher {
  const served = (name: string): { spec: McpToolSpec; tool: ServedTool } | undefined => {
    const spec = toolNamed(name);
    const tool = spec === undefined ? undefined : deps.tools[spec.name];
    return spec === undefined || tool === undefined ? undefined : { spec, tool };
  };

  return {
    list: (grant, actor) =>
      Object.entries(deps.tools).flatMap(([name, tool]) => {
        const spec = toolNamed(name);
        // An owner-only tool is the owner's, on an access of the agency, and an agency-only one is never listed on an
        // access bound to a creator: listed to no one `decideCall` would refuse.
        if (spec === undefined) return [];
        const listed =
          (spec.ownerOnly !== true || (grant.creatorId === null && actor.role === 'owner')) &&
          (spec.agencyOnly !== true || grant.creatorId === null);
        return listed && holds(grant, spec.capability)
          ? [{ name, description: tool.description, input: tool.input }]
          : [];
      }),

    async call(call) {
      const record = async (
        tool: string | null,
        outcome: McpCallRefusal | 'ok' | 'error',
        creatorId: string | null,
        subject: Readonly<Record<string, string>> = {},
      ) =>
        deps.journal.record({
          userId: call.grant.userId,
          grantId: call.grant.id,
          tool,
          outcome,
          creatorId,
          subject,
          requestId: call.requestId,
          ip: call.ip,
        });
      const refuse = async (
        tool: string | null,
        refusal: McpCallRefusal,
        creatorId: string | null = call.grant.creatorId,
      ): Promise<McpCallResult> => {
        await record(tool, refusal, creatorId);
        return { ok: false, refusal };
      };

      const found = served(call.name);
      if (found === undefined) return refuse(null, 'tool_unknown');
      const { spec, tool } = found;
      const input = tool.input.safeParse(call.args ?? {});
      if (!input.success) return refuse(spec.name, 'arguments_invalid');
      const decision = decideCall(spec, call.grant, call.actor, namedCreatorOf(input.data));
      if (!decision.ok) return refuse(spec.name, decision.refusal);
      const subject = tool.subject?.(input.data) ?? {};
      if (!(await deps.spendRead(call.grant))) {
        await record(spec.name, 'rate_limited', decision.creatorId, subject);
        return { ok: false, refusal: 'rate_limited' };
      }

      let value: Record<string, unknown>;
      try {
        value = tool.output.parse(
          await tool.run({ grant: call.grant, actor: call.actor, creatorId: decision.creatorId }, input.data),
        );
      } catch (error) {
        await record(spec.name, 'error', decision.creatorId, subject);
        throw error;
      }
      await record(spec.name, 'ok', decision.creatorId, subject);
      return { ok: true, value };
    },
  };
}

/** `whoami` (ADR 0026 § 5): the access itself, no capability needed. */
export const whoami: ServedTool = {
  description:
    'L’accès avec lequel tu appelles : son nom, sa créatrice (aucune pour un accès d’agence), ses capacités, son expiration, et la version du catalogue.',
  input: z.strictObject({}),
  output: McpWhoamiSchema,
  run: ({ grant }): Promise<McpWhoami> =>
    Promise.resolve({
      grantId: grant.id,
      label: grant.label,
      creatorId: grant.creatorId,
      capabilities: [...grant.capabilities],
      expiresAt: grant.expiresAt.toISOString(),
      catalogueVersion: MCP_CATALOGUE_VERSION,
    }),
};
