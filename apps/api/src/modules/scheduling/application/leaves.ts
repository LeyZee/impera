import type {
  CreateLeaveRequestBodySchema,
  CreatorId,
  DecideLeaveRequestBodySchema,
  LeaveRequest,
  LeaveRequestId,
  LeaveRequestList,
  LeaveRequestQuery,
  UserId,
} from '@nirvana/contracts';
import type { z } from 'zod';

import { assertLeaveRange } from '../domain/leaves';
import type { Actor, LeaveStore } from '../domain/ports';

import { toLeaveRequestDto, toPlanningMember } from './dto';

/** Leaves (ADR 0031): a member asks their own, the owner or an active manager decides, never a manager their own. */
export interface LeaveService {
  list(actor: UserId, query: LeaveRequestQuery): Promise<LeaveRequestList>;
  /** `created` is false when the same request was already recorded (the route answers 200). */
  create(
    actor: Actor,
    body: z.output<typeof CreateLeaveRequestBodySchema>,
  ): Promise<{ leave: LeaveRequest; created: boolean }>;
  decide(
    actor: Actor,
    id: LeaveRequestId,
    body: z.output<typeof DecideLeaveRequestBodySchema>,
  ): Promise<LeaveRequest>;
  end(actor: Actor, id: LeaveRequestId): Promise<void>;
}

export function createLeaveService(
  store: LeaveStore,
  everyCreator: () => Promise<CreatorId[]>,
  now: () => Date = () => new Date(),
): LeaveService {
  return {
    list: async (actor, query) => {
      const from = new Date(query.from);
      const to = new Date(query.to);
      assertLeaveRange(from, to);
      const read = await store.list(actor, { from, to });
      return {
        leaveRequests: read.leaves.map(toLeaveRequestDto),
        members: read.members.map(toPlanningMember),
      };
    },

    create: async (actor, body) => {
      const { leave, created } = await store.create(actor, body, now());
      return { leave: toLeaveRequestDto(leave), created };
    },

    // Every creator there is: the member's shifts and swaps may be on any of them, the policies narrow the rest.
    decide: async (actor, id, body) =>
      toLeaveRequestDto(await store.decide(actor, id, body, await everyCreator(), now())),

    end: (actor, id) => store.end(actor, id, now()),
  };
}
