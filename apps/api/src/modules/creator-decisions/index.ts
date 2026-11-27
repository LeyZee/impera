/** Public entry point of the `creator-decisions` module (ADR 0164, « À décider »). Other modules import this file only. */
import type { CreatorDecisionKind, NotificationOutcome, NotificationRequest } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { askAndTell } from './application/ask';
import { otherIdeas } from './application/other-ideas';
import type { DecisionAsking, OtherIdeasWriter } from './domain/ports';
import { createDrizzleDecisionAsking, createDrizzleDecisionStore } from './infra/db/decision-store';
import { createDecisionRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorDecisionsModule {
  readonly name: 'creator-decisions';
  /** Mounted under `/v1`: her `/creator-space/decisions`, the owner's `/creators/:creatorId/decisions`. */
  readonly routes: FastifyPluginAsyncZod;
  /** The door of the code that asks her something: one creator at a time, once per subject. */
  readonly asking: DecisionAsking;
}

export interface CreatorDecisionsDeps {
  /** Application role: her account, the owner's, and the code that asks under its own name. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /**
   * Who proposes other answers, by kind of decision (ADR 0164 § 9), wired by the composition root: this module knows
   * nothing of what a caption is.
   */
  readonly otherIdeas?: Partial<Record<CreatorDecisionKind, OtherIdeasWriter>>;
  /** The `notifications` module's `notify`, to tell her of a new question; `null` or absent when push is off. */
  readonly notify?: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorDecisionsModule(deps: CreatorDecisionsDeps): CreatorDecisionsModule {
  const store = createDrizzleDecisionStore(deps.db);
  const clock = deps.clock ?? (() => new Date());
  const stored = createDrizzleDecisionAsking(deps.db);
  const asking: DecisionAsking = {
    ...stored,
    ask: (creatorId, decision) =>
      askAndTell({ asking: stored, notify: deps.notify ?? null }, creatorId, decision, clock()),
  };
  const writers = deps.otherIdeas ?? {};
  return {
    name: 'creator-decisions',
    routes: createDecisionRoutes({
      store,
      otherIdeas: (userId, id, wish, now) => otherIdeas({ store, asking, writers }, userId, id, wish, now),
      requireRole: deps.requireRole,
      ...(deps.clock !== undefined && { clock: deps.clock }),
    }),
    asking,
  };
}
