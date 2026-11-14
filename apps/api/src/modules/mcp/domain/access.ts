import { MCP_OWNER_ONLY_CAPABILITIES, type McpCapability } from '@impera/contracts';

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
  /** ADR 0023: a creator's own account never reads a conversation nor a fan. */
  | 'role_forbidden';

export type McpDecision = { readonly ok: true } | { readonly ok: false; readonly refusal: McpRefusal };

const CREATOR_NEVER_READS: readonly McpCapability[] = [
  'read:conversations',
  'read:conversation_content',
  'read:fans',
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
    if (actor.role === 'creator' && CREATOR_NEVER_READS.includes(capability)) return refuse('role_forbidden');
  }
  if (tool.scope !== 'creator') return { ok: true };
  if (grant.creatorId === null) return refuse('creator_required');
  const creatorId = namedCreatorId ?? grant.creatorId;
  if (creatorId !== grant.creatorId) return refuse('creator_forbidden');
  const readable = actor.readableCreatorIds === 'all' || actor.readableCreatorIds.includes(creatorId);
  return readable ? { ok: true } : refuse('creator_forbidden');
}

/**
 * What is wrong with the capabilities asked for a new access, empty when nothing: the owner creates every access in
 * lot a (ADR 0026 § 3), and the owner-only ones go on an access in his own name only.
 */
export function grantProblems(
  capabilities: readonly McpCapability[],
  personRole: ActorView['role'],
): readonly ('capability_repeated' | 'owner_only')[] {
  const problems: ('capability_repeated' | 'owner_only')[] = [];
  if (new Set(capabilities).size !== capabilities.length) problems.push('capability_repeated');
  if (personRole !== 'owner' && capabilities.some((c) => MCP_OWNER_ONLY_CAPABILITIES.includes(c)))
    problems.push('owner_only');
  return problems;
}
