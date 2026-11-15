import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type FanCardRead,
  type FanId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createJobQueue, type JobQueue } from '../jobs';
import {
  createConversationsModule,
  type CardReader,
  type ConversationsModule,
} from '../modules/conversations';
import { createFansModule, type FansModule } from '../modules/fans';

const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const CHATTER = newId(UserIdSchema);

type ReadInput = Parameters<CardReader['read']>[0];
type ReadResult = Awaited<ReturnType<CardReader['read']>>;

/** The AI's read, scripted: what it was given, and what it answers. */
class ScriptedReader implements CardReader {
  readonly inputs: ReadInput[] = [];
  next: ReadResult = { ok: true, read: { facts: [] } };

  read(input: ReadInput): Promise<ReadResult> {
    this.inputs.push(input);
    return Promise.resolve(this.next);
  }
}

const fact = (over: Partial<FanCardRead['facts'][number]>): FanCardRead['facts'][number] => ({
  field: 'age',
  items: ['34'],
  kind: 'declared',
  confidence: 0.9,
  message: 1,
  ...over,
});

const ReadJobSchema = z.object({ key: z.string(), runAt: z.coerce.date() });

/** ADR 0085 § 7: his card read in his messages, whoever answers him. Invented fans and messages (ADR 0010). */
describe('fans.read_card', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let fans: FansModule;
  let conversations: ConversationsModule;
  const reader = new ScriptedReader();
  let counter = 0;

  async function fanWrites(conversation: string, text: string): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Fan inventé',
      message: {
        ref: { platform: 'reveal', id: `r-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text,
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date(Date.now() + counter).toISOString(),
      },
      correlationId: 'test',
    });
    return conversationId;
  }

  const read = (conversationId: ConversationId) =>
    conversations.jobs.readCard({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);

  async function readJob(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`select j.key, j.run_at as "runAt" from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
          where t.identifier = 'fans.read_card' and j.payload->>'conversationId' = ${conversationId}`,
    );
    return result.rows.map((row) => ReadJobSchema.parse(row));
  }

  async function fanOf(conversationId: ConversationId): Promise<FanId> {
    const [row] = await test.admin.db
      .select({ fanId: schema.conversations.fanId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (row === undefined) throw new Error('no conversation');
    return FanIdSchema.parse(row.fanId);
  }

  const field = async (fanId: FanId, code: string) =>
    (await fans.card(creatorId, fanId)).fields.find((entry) => entry.field === code);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creatorId,
      nameKey: creatorId,
      displayName: 'Créatrice inventée',
      timezone: 'Europe/Paris',
    });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'card-read' });
    await test.admin.db
      .insert(schema.user)
      .values({ id: CHATTER, name: 'Léa', email: 'lea@nirvana.test', creatorIds: [creatorId] });
    fans = createFansModule({ db: test.app.db, adminDb: test.service.db });
    conversations = createConversationsModule({
      db: test.app.db,
      adminDb: test.service.db,
      fans,
      sender: {
        sendText: () => Promise.reject(new Error('not used')),
        sendMedia: () => Promise.reject(new Error('not used')),
        verifySent: () => Promise.resolve({ status: 'not_found' }),
      },
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      cardReader: reader,
    });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  it('puts one read off five minutes after his last message, and runs it at once after ten', async () => {
    const before = Date.now();
    await fanWrites('c-pace', 'Salut');
    const id = await fanWrites('c-pace', 'Ça va ?');
    const [job, ...others] = await readJob(id);
    expect(others).toEqual([]);
    expect(job?.runAt.getTime()).toBeGreaterThan(before + 4 * 60_000);

    for (let n = 0; n < 8; n += 1) await fanWrites('c-pace', `Message ${String(n)}`);
    const [burst] = await readJob(id);
    expect(burst?.runAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it('reads his new messages with the card, writes what he said, and the observed fields as guessed', async () => {
    await fanWrites('c-read', 'Coucou');
    const id = await fanWrites('c-read', 'J’ai 34 ans, je suis payé début du mois');
    reader.next = {
      ok: true,
      read: {
        facts: [
          fact({ field: 'age', items: ['34'], message: 2 }),
          fact({ field: 'payday', items: ['début du mois'], kind: 'declared', message: 2 }),
          // A message the read was not given: nothing to rest on.
          fact({ field: 'job', items: ['plombier'], message: 9 }),
        ],
      },
    };

    await read(id);

    const input = reader.inputs.at(-1);
    expect(input?.card).toEqual([]);
    expect(input?.messages).toEqual([
      { number: 1, from: 'fan', text: 'Coucou', isNew: true },
      { number: 2, from: 'fan', text: 'J’ai 34 ans, je suis payé début du mois', isNew: true },
    ]);
    const fanId = await fanOf(id);
    expect((await field(fanId, 'age'))?.current).toMatchObject({ items: ['34'], source: 'declared' });
    expect((await field(fanId, 'payday'))?.current).toMatchObject({ source: 'inferred' });
    expect((await field(fanId, 'job'))?.current).toBeNull();

    // Read: nothing new until he writes again, then the card goes with his new message.
    const calls = reader.inputs.length;
    await read(id);
    expect(reader.inputs).toHaveLength(calls);
    await fanWrites('c-read', 'J’adore le foot');
    // His one new message, not those read: the next read waits five minutes, then ten after the last.
    const [job] = await readJob(id);
    expect(job?.runAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    reader.next = { ok: true, read: { facts: [] } };
    await read(id);
    expect(reader.inputs.at(-1)?.card).toEqual(
      expect.arrayContaining(['age : 34 (dit par lui)', 'payday : début du mois (deviné)']),
    );
    expect(reader.inputs.at(-1)?.messages.map((message) => message.isNew)).toEqual([false, false, true]);
  });

  it('lets a chatter’s note stand, and puts what contradicts it « à vérifier »', async () => {
    const id = await fanWrites('c-note', 'Salut');
    const fanId = await fanOf(id);
    await fans.editCard(creatorId, fanId, 'location', { items: ['Annecy'] }, CHATTER);
    await fanWrites('c-note', 'Je vis à Lyon maintenant');
    reader.next = {
      ok: true,
      read: { facts: [fact({ field: 'location', items: ['Lyon'], message: 2 })] },
    };

    await read(id);

    const location = await field(fanId, 'location');
    expect(location?.current).toMatchObject({ items: ['Annecy'], source: 'noted', notedByName: 'Léa' });
    expect(location?.toCheck).toEqual([expect.objectContaining({ items: ['Lyon'], source: 'declared' })]);
  });

  it('never writes what the card never keeps, nor a value outside its field', async () => {
    const id = await fanWrites('c-never', 'Ajoute-moi sur snap @basile_42, et j’aime que tu sois douce');
    reader.next = {
      ok: true,
      read: {
        facts: [
          fact({ field: 'hobbies', items: ['snap @basile_42'], message: 1 }),
          fact({ field: 'intensity', items: ['tendre'], kind: 'inferred', message: 1 }),
        ],
      },
    };

    await read(id);

    const fanId = await fanOf(id);
    expect((await field(fanId, 'hobbies'))?.current).toBeNull();
    expect((await field(fanId, 'intensity'))?.current).toBeNull();
  });

  it('marks nothing read when the read is refused, so his next message reads them again', async () => {
    const id = await fanWrites('c-budget', 'J’aime les séries');
    reader.next = { ok: false, reason: 'budget' };

    await read(id);

    const [row] = await test.admin.db
      .select({ at: schema.conversations.cardReadAt })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    expect(row?.at).toBeNull();
    reader.next = { ok: true, read: { facts: [] } };
    await read(id);
    expect(reader.inputs.at(-1)?.messages).toEqual([
      { number: 1, from: 'fan', text: 'J’aime les séries', isNew: true },
    ]);
  });
});
