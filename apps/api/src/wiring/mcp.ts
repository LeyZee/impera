import { resolveActor } from '../auth';
import type { FansModule } from '../modules/fans';
import { createMcpModule, type ActorView, type McpModule } from '../modules/mcp';
import type { PersonaModule } from '../modules/persona';
import type { ShiftCreators } from '../modules/scheduling';

import type { Routes, Shared } from './shared';

export interface WiredMcp {
  readonly module: McpModule;
  readonly routes: readonly Routes[];
}

/**
 * The person an access acts for, as `resolveActor` reads a session (ADR 0026 § 4): the creators he reads now are all
 * for the owner, his own for a creator, his for an active manager, those his shift opens for a member in `self`
 * (ADR 0025), never more.
 */
async function actorOf(
  shared: Shared,
  shiftCreators: ShiftCreators,
  userId: string,
): Promise<ActorView | null> {
  const resolved = await resolveActor(shared.db, shiftCreators, userId);
  if (resolved === null) return null;
  const { user, membership, secondFactorEnabled } = resolved;
  const readableCreatorIds =
    user.role === 'owner'
      ? 'all'
      : user.role === 'operator' && membership.teamScope === 'self'
        ? user.shiftCreatorIds
        : user.creatorIds;
  return { role: user.role, teamScope: membership.teamScope, secondFactorEnabled, readableCreatorIds };
}

/** The MCP server (ADR 0026, 0105), lot a: the owner's agent accesses, and `POST /v1/mcp`. */
export function wireMcp(
  shared: Shared,
  shiftCreators: ShiftCreators,
  persona: Pick<PersonaModule, 'creators'>,
  fans: Pick<FansModule, 'getFan' | 'activeFacts' | 'flags' | 'card'>,
): WiredMcp {
  const module = createMcpModule({
    db: shared.db,
    adminDb: shared.adminDb,
    actorOf: (userId) => actorOf(shared, shiftCreators, userId),
    // Only what the tools read: never a write of either module.
    creators: { unarchived: (ids) => persona.creators.unarchived(ids) },
    fans: {
      getFan: (creatorId, fanId) => fans.getFan(creatorId, fanId),
      activeFacts: (creatorId, fanId) => fans.activeFacts(creatorId, fanId),
      flags: (creatorId, fanId) => fans.flags(creatorId, fanId),
      card: (creatorId, fanId) => fans.card(creatorId, fanId),
    },
  });
  return {
    module,
    routes: [
      module.routes({ guard: shared.requireRole('owner'), recentLogin: shared.recentLogin }),
      module.transport(),
    ],
  };
}
