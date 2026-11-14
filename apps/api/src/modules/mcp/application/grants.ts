import {
  McpGrantIdSchema,
  newId,
  type CreateMcpGrantBody,
  type McpGrant,
  type McpGrantCreated,
  type McpGrantId,
  type McpGrantRefusalKind,
} from '@impera/contracts';

import { grantProblems, type ActorView } from '../domain/access';
import type { GrantRecord, McpGrantStore, McpOwner, MintedToken } from '../domain/ports';

export interface GrantsDeps {
  readonly store: McpGrantStore;
  readonly mint: () => MintedToken;
  readonly hashOf: (token: string) => string;
  readonly now: () => Date;
}

const DAY_MS = 86_400_000;

type CreateGrantResult =
  | { readonly ok: true; readonly value: McpGrantCreated }
  | { readonly ok: false; readonly kind: McpGrantRefusalKind };

export interface GrantsApi {
  list(owner: McpOwner): Promise<readonly McpGrant[]>;
  /** The access and its token, once; a refusal by its kind when the capabilities break a rule of `grantProblems`. */
  create(
    owner: McpOwner,
    person: Pick<ActorView, 'role' | 'teamScope'>,
    body: CreateMcpGrantBody,
  ): Promise<CreateGrantResult>;
  revoke(owner: McpOwner, id: McpGrantId): Promise<boolean>;
  /**
   * The live access a token names, its last use stamped as its person; `null` for a token unknown, revoked or
   * expired. The person's rights are not read here: the dispatcher reads them at every call (`resolveActor`).
   */
  grantOfToken(token: string): Promise<GrantRecord | null>;
}

const viewOf = (grant: GrantRecord): McpGrant => ({
  id: grant.id,
  label: grant.label,
  creatorId: grant.creatorId,
  capabilities: [...grant.capabilities],
  createdAt: grant.createdAt.toISOString(),
  expiresAt: grant.expiresAt.toISOString(),
  lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
  revokedAt: grant.revokedAt?.toISOString() ?? null,
});

/**
 * Réglages › Agents connectés (ADR 0026 § 3, ADR 0105): the owner lists, creates and revokes his agent accesses; the
 * transport finds the access of a token. No capability is ticked by default; an access lives 90 days at most.
 */
export function createGrants(deps: GrantsDeps): GrantsApi {
  return {
    list: async (owner) => (await deps.store.list(owner)).map(viewOf),

    async create(owner, person, body) {
      const [problem] = grantProblems(body.capabilities, person);
      if (problem !== undefined) return { ok: false, kind: problem };
      const minted = deps.mint();
      const created = await deps.store.create(owner, {
        id: newId(McpGrantIdSchema),
        label: body.label,
        creatorId: body.creatorId,
        capabilities: body.capabilities,
        tokenHash: minted.hash,
        expiresAt: new Date(deps.now().getTime() + body.days * DAY_MS),
      });
      return { ok: true, value: { ...viewOf(created), token: minted.token } };
    },

    revoke: (owner, id) => deps.store.revoke(owner, id),

    async grantOfToken(token) {
      const grant = await deps.store.findByTokenHashUnscoped(deps.hashOf(token));
      if (grant?.revokedAt !== null || grant.expiresAt <= deps.now()) return null;
      await deps.store.touch(grant.userId, grant.id);
      return grant;
    },
  };
}
