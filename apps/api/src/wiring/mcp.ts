import { UserIdSchema } from '@impera/contracts';

import { resolveActor } from '../auth';
import type { AiUsageModule } from '../modules/ai-usage';
import type { ContentDropsModule } from '../modules/content-drops';
import type { FansModule } from '../modules/fans';
import { createMcpModule, type ActorView, type McpModule } from '../modules/mcp';
import type { PersonaModule } from '../modules/persona';
import type { SchedulingModule, ShiftCreators } from '../modules/scheduling';
import type { ScriptsModule } from '../modules/scripts';

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
  content: {
    readonly drops: Pick<ContentDropsModule, 'reads'>;
    readonly scripts: Pick<ScriptsModule, 'reads'>;
  },
  scheduling: Pick<SchedulingModule, 'reads'>,
  aiUsage: Pick<AiUsageModule, 'read'>,
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
    content: {
      drops: (creatorId, reader, page) => content.drops.reads.drops(creatorId, reader, page),
      scripts: (creatorId, reader) => content.drops.reads.scripts(creatorId, reader),
      scriptSteps: (creatorId, reader, dropId) => content.drops.reads.scriptSteps(creatorId, reader, dropId),
      queue: (creatorId, reader) => content.scripts.reads.queue(creatorId, reader),
    },
    shifts: {
      shifts: (reader, creators, range) =>
        scheduling.reads.shifts(
          { userId: UserIdSchema.parse(reader.userId), role: reader.role },
          creators,
          range,
        ),
      onShiftNow: (reader, creators, at) =>
        scheduling.reads.onShiftNow(
          { userId: UserIdSchema.parse(reader.userId), role: reader.role },
          creators,
          at,
        ),
    },
    aiUsage: { read: () => aiUsage.read() },
  });
  return {
    module,
    routes: [
      module.routes({ guard: shared.requireRole('owner'), recentLogin: shared.recentLogin }),
      module.transport(),
    ],
  };
}
