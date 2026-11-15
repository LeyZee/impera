import { ConversationIdSchema, CreatorIdSchema, CurrentUserSchema, UserIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ConversationReader } from '../../domain/ports';
import { createConversationReads, readsWholeCreator, viewerOf, type ConversationViewer } from '../reads';

const HER = CreatorIdSchema.parse('00000000-0000-4000-8000-000000000001');
const OTHER = CreatorIdSchema.parse('00000000-0000-4000-8000-000000000002');
const CONVERSATION = ConversationIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const ORIGIN = { ip: '203.0.113.7' };
const PAGE = { limit: 20 };

const viewer = (scope: Partial<Omit<ConversationViewer, 'userId'>>): ConversationViewer => ({
  userId: USER,
  wholeCreators: [],
  shiftCreators: [],
  routedCreators: [],
  ...scope,
});

/** A reader that records what it is asked, holds what `held` says and has what `has` says. */
function fakeReader(options: { held?: boolean; has?: boolean } = {}) {
  const calls: string[] = [];
  const empty = { items: [], nextCursor: null };
  const unused = (): never => {
    throw new Error('not read by the reads');
  };
  const reader: ConversationReader = {
    list: (_creatorId, _page, reader) => {
      calls.push(`list heldOnly=${String(reader.heldOnly)}`);
      return Promise.resolve(empty);
    },
    isHeldBy: () => Promise.resolve(options.held ?? false),
    holderOf: unused,
    isFanHeldBy: unused,
    traceOpening: (_creatorId, _id, trace) => {
      calls.push(`trace ${trace.via ?? 'open'}`);
      return Promise.resolve(options.has ?? true);
    },
    traceFanOpening: unused,
    fanMessageTexts: unused,
    get: () => Promise.resolve(null),
    messages: () => {
      calls.push('messages');
      return Promise.resolve(empty);
    },
    events: () => Promise.resolve(empty),
    desireCurve: () => Promise.resolve(null),
    sendingStopped: () => Promise.resolve(true),
  };
  return { reader, calls };
}

describe('conversation reads (ADR 0026 § 1)', () => {
  it('gives the owner every creator, and the others only the creators listed on them', () => {
    const owner = viewerOf(
      CurrentUserSchema.parse({
        id: USER,
        email: 'o@example.test',
        name: 'O',
        role: 'owner',
        creatorIds: [],
      }),
    );
    expect(owner.wholeCreators).toBe('all');
    expect(readsWholeCreator(owner, OTHER)).toBe(true);
    const chatter = viewerOf(
      CurrentUserSchema.parse({
        id: USER,
        email: 'c@example.test',
        name: 'C',
        role: 'operator',
        creatorIds: [],
        shiftCreatorIds: [HER],
      }),
    );
    expect(chatter.wholeCreators).toEqual([]);
    expect(chatter.shiftCreators).toEqual([HER]);
    expect(readsWholeCreator(chatter, HER)).toBe(false);
  });

  it('reads the whole creator without a trace, and refuses a creator out of scope', async () => {
    const { reader, calls } = fakeReader();
    const reads = createConversationReads(reader);
    const manager = viewer({ wholeCreators: [HER] });
    await reads.messages(manager, HER, CONVERSATION, PAGE, ORIGIN);
    await reads.list(manager, HER, PAGE);
    expect(calls).toEqual(['messages', 'list heldOnly=false']);
    await expect(reads.list(manager, OTHER, PAGE)).rejects.toMatchObject({ code: 'creator_forbidden' });
    await expect(reads.stopped(manager, OTHER)).rejects.toMatchObject({ code: 'creator_forbidden' });
  });

  it('traces a chatter’s opening in his window first, and answers 404 for a conversation she does not have', async () => {
    const present = fakeReader();
    const chatter = viewer({ shiftCreators: [HER] });
    await createConversationReads(present.reader).messages(chatter, HER, CONVERSATION, PAGE, ORIGIN);
    expect(present.calls).toEqual(['trace messages', 'messages']);

    const absent = fakeReader({ has: false });
    await expect(
      createConversationReads(absent.reader).messages(chatter, HER, CONVERSATION, PAGE, ORIGIN),
    ).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(absent.calls).toEqual(['trace messages']);
  });

  it('lets a member in `self` list and read only what he holds', async () => {
    const routed = viewer({ routedCreators: [HER] });
    const notHeld = fakeReader({ held: false });
    const reads = createConversationReads(notHeld.reader);
    await reads.list(routed, HER, PAGE);
    expect(notHeld.calls).toEqual(['list heldOnly=true']);
    await expect(reads.get(routed, HER, CONVERSATION, ORIGIN)).rejects.toMatchObject({
      code: 'conversation_forbidden',
    });
    await expect(reads.list(routed, OTHER, PAGE)).rejects.toMatchObject({ code: 'creator_forbidden' });
    expect(await reads.stopped(routed, HER)).toBe(true);

    const held = fakeReader({ held: true });
    await expect(createConversationReads(held.reader).actorOn(routed, HER, CONVERSATION)).resolves.toBe(USER);
  });
});
