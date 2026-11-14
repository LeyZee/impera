import {
  MCP_CAPABILITIES,
  MCP_OWNER_ONLY_CAPABILITIES,
  type McpCapability,
  type TeamScope,
} from '@impera/contracts';

import type { McpToolSpec } from './catalogue';

/**
 * Who may call what (ADR 0026 § 4, ADR 0105 § 1): the intersection of the person's rights now, the access's creator,
 * and its capabilities. Pure: the dispatcher reads the person with `resolveActor` at every call, never from a cache, so
 * a member who left, lost a creator or changed role loses at once what he no longer has.
 */

/** An agent access as the rule needs it, never its token. */
export interface GrantView {
  readonly capabilities: readonly McpCapability[];
  /** Zero or one creator (ADR 0026 § 3). */
  readonly creatorId: string | null;
}

/** The person the access acts for, as read now. */
export interface ActorView {
  readonly role: 'owner' | 'operator' | 'creator';
  /** As `/v1/me` gives it: a manager who is no longer active falls to `self`. */
  readonly teamScope: TeamScope;
  readonly secondFactorEnabled: boolean;
  /** The creators he may read now: `all` for the owner, his own for a creator, those his shift opens for a member. */
  readonly readableCreatorIds: 'all' | readonly string[];
}

type McpRefusal =
  /** ADR 0105 § 1: a token never stands in for the second factor. */
  | 'second_factor_required'
  | 'capability_missing'
  /** ADR 0105 § 2.5 and § 4: ticked only on an access in the owner's name, and only while he is the owner. */
  | 'owner_only'
  /** ADR 0026 § 4: an access without a creator calls no tool of a creator. */
  | 'creator_required'
  /** Another creator than the access's, or one the person may no longer read. */
  | 'creator_forbidden'
  /** The person's role and team scope never open this capability or this tool (ADR 0023, ADR 0026 § 3). */
  | 'role_forbidden';

export type McpDecision =
  | {
      readonly ok: true;
      /**
       * The creator the call is confined to: the access's, on a tool of the agency too, where the dispatcher keeps only
       * what concerns her. `null` only for an access without a creator, read within the person's team scope.
       */
      readonly creatorId: string | null;
    }
  | { readonly ok: false; readonly refusal: McpRefusal };

type Person = Pick<ActorView, 'role' | 'teamScope'>;

/**
 * What each role and team scope may ever hold, the rest refused (an allow-list, never a deny-list). The owner holds
 * all; an active manager all but the owner's own, the pay and the drops; a chatter nothing until the access bound to
 * his shift (ADR 0025, ADR 0026 § 3); a creator her routine, her revenue, who is on shift, her media, her tasks and her
 * drops, never a conversation, a fan nor the team's pay (ADR 0023, ADR 0105 § 4 bis). A pair absent from the table
 * opens nothing.
 */
const ALLOWED: Readonly<Record<string, readonly McpCapability[]>> = {
  'owner:owner': MCP_CAPABILITIES,
  'operator:agency': MCP_CAPABILITIES.filter(
    (c) => !MCP_OWNER_ONLY_CAPABILITIES.includes(c) && c !== 'read:payroll' && c !== 'write:drops',
  ),
  'operator:self': [],
  'creator:self': ['read:status', 'read:team', 'read:sales', 'read:media', 'write:tasks', 'write:drops'],
};

const allowedFor = (person: Person): readonly McpCapability[] =>
  ALLOWED[`${person.role}:${person.teamScope}`] ?? [];

/**
 * Tools of a capability a creator holds that still reach the team's work or pay: ADR 0023 shows her who is on shift
 * and her own revenue, never a chatter's sales, reports or statements.
 */
const CREATOR_NEVER_CALLS: readonly string[] = [
  'sales_by_chatter',
  'shift_reports_list',
  'team_import_list',
  'commission_statements_list',
];

const refuse = (refusal: McpRefusal): McpDecision => ({ ok: false, refusal });

/**
 * Whether this call may run: the tool, the access, the person now, and the creator the call names (for a tool of a
 * creator, the access's own when the call names none).
 */
export function decideCall(
  tool: McpToolSpec,
  grant: GrantView,
  actor: ActorView,
  namedCreatorId?: string,
): McpDecision {
  if (!actor.secondFactorEnabled) return refuse('second_factor_required');
  const { capability } = tool;
  if (capability !== null) {
    if (!grant.capabilities.includes(capability)) return refuse('capability_missing');
    if (MCP_OWNER_ONLY_CAPABILITIES.includes(capability) && actor.role !== 'owner')
      return refuse('owner_only');
    if (!allowedFor(actor).includes(capability)) return refuse('role_forbidden');
  }
  if (actor.role === 'creator' && CREATOR_NEVER_CALLS.includes(tool.name)) return refuse('role_forbidden');
  if (tool.scope !== 'creator') return { ok: true, creatorId: grant.creatorId };
  if (grant.creatorId === null) return refuse('creator_required');
  const creatorId = namedCreatorId ?? grant.creatorId;
  if (creatorId !== grant.creatorId) return refuse('creator_forbidden');
  const readable = actor.readableCreatorIds === 'all' || actor.readableCreatorIds.includes(creatorId);
  return readable ? { ok: true, creatorId } : refuse('creator_forbidden');
}

type GrantProblem = 'capability_repeated' | 'owner_only' | 'role_forbidden';

/**
 * What is wrong with the capabilities asked for a new access, empty when nothing: the owner creates every access in
 * lot a (ADR 0026 § 3), the owner-only ones go on an access in his own name only, and none goes beyond what the
 * person's role and team scope may ever hold.
 */
export function grantProblems(
  capabilities: readonly McpCapability[],
  person: Person,
): readonly GrantProblem[] {
  const problems: GrantProblem[] = [];
  if (new Set(capabilities).size !== capabilities.length) problems.push('capability_repeated');
  const beyond = capabilities.filter((c) => !allowedFor(person).includes(c));
  if (beyond.some((c) => MCP_OWNER_ONLY_CAPABILITIES.includes(c))) problems.push('owner_only');
  if (beyond.some((c) => !MCP_OWNER_ONLY_CAPABILITIES.includes(c))) problems.push('role_forbidden');
  return problems;
}
