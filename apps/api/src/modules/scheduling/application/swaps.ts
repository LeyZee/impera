import {
  SHIFT_SWAP_RECENT_DAYS,
  SHIFT_TEMPLATE_HORIZON_DAYS,
  type CreateShiftSwapRequestBodySchema,
  type CreatorId,
  type CreatorSummary,
  type ShiftId,
  type ShiftSwapList,
  type ShiftSwapRequest,
  type ShiftSwapRequestId,
  type SwapCandidates,
  type UserId,
} from '@nirvana/contracts';
import type { z } from 'zod';

import type { Actor, ColleagueReads, SwapStore } from '../domain/ports';
import { addMinutes } from '../domain/time';

import { toPlanningAccount, toPlanningMember, toShiftDto, toSwapDto } from './dto';

/**
 * Swaps between chatters (ADR 0031, Charles 27/10 « Comme Imperium, sans manager »): the shift's member proposes,
 * the colleague asked answers, the owner or an active manager sees every swap and can revert one.
 */
export interface SwapService {
  list(actor: UserId): Promise<ShiftSwapList>;
  candidates(actor: UserId, shiftId: ShiftId): Promise<SwapCandidates>;
  /** `created` is false when the same swap was already recorded (the route answers 200). */
  propose(
    actor: Actor,
    body: z.output<typeof CreateShiftSwapRequestBodySchema>,
  ): Promise<{ swap: ShiftSwapRequest; created: boolean }>;
  answer(actor: Actor, id: ShiftSwapRequestId, answer: 'accept' | 'decline'): Promise<ShiftSwapRequest>;
  end(actor: Actor, id: ShiftSwapRequestId): Promise<void>;
}

export function createSwapService(
  store: SwapStore,
  colleagues: ColleagueReads,
  creators: { list(): Promise<readonly CreatorSummary[]> },
  now: () => Date = () => new Date(),
): SwapService {
  const names = async (): Promise<ReadonlyMap<string, CreatorSummary>> =>
    new Map((await creators.list()).map((creator) => [creator.id, creator]));
  const everyCreator = async (): Promise<CreatorId[]> => (await creators.list()).map((creator) => creator.id);

  return {
    list: async (actor) => {
      const read = await store.list(
        actor,
        await everyCreator(),
        addMinutes(now(), -SHIFT_SWAP_RECENT_DAYS * 24 * 60),
      );
      // The members the swaps name, read after the policies showed the swaps to the reader: name and colour only.
      const named = new Set([
        ...read.swaps.flatMap((swap) => [swap.requesterId, swap.targetMemberId]),
        ...read.shifts.map((shift) => shift.memberId),
      ]);
      const creatorNames = await names();
      return {
        swapRequests: read.swaps.map(toSwapDto),
        shifts: read.shifts.map(toShiftDto),
        accounts: read.accounts.map((account) => toPlanningAccount(account, creatorNames)),
        members: (await colleagues.namesUnscoped([...named])).map(toPlanningMember),
      };
    },

    candidates: async (actor, shiftId) => {
      const at = now();
      // The shift is the reader's and ahead, read under the policies; only then are colleagues read.
      const { shift, creatorIds } = await store.offeredShift(actor, shiftId, at);
      const found = await colleagues.candidatesUnscoped(
        shift,
        creatorIds,
        at,
        addMinutes(at, SHIFT_TEMPLATE_HORIZON_DAYS * 24 * 60),
      );
      const creatorNames = await names();
      return {
        candidates: found.members
          .toSorted((a, b) => a.displayName.localeCompare(b.displayName, 'fr') || a.id.localeCompare(b.id))
          .map((member) => ({
            member: toPlanningMember(member),
            freeThen: member.freeThen,
            shifts: found.shifts
              .filter((one) => one.memberId === member.id)
              .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
              .map(toShiftDto),
          })),
        accounts: found.accounts.map((account) => toPlanningAccount(account, creatorNames)),
      };
    },

    propose: async (actor, body) => {
      const { swap, created } = await store.propose(actor, body, now());
      return { swap: toSwapDto(swap), created };
    },

    answer: async (actor, id, answer) => toSwapDto(await store.answer(actor, id, answer, now())),

    end: (actor, id) => store.end(actor, id, now()),
  };
}
