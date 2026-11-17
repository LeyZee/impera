import {
  ConnectorConfigSchema,
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeReveal, type FakeReveal } from '../../../../__tests__/fake-reveal/server';
import type { NoteLineMemory, NoteSlotValue } from '../../domain/agency-note';
import type { ConnectorAccount, NoteLineStore } from '../../domain/ports';
import { MemorySendJournal } from '../../infra/__tests__/memory-send-journal';
import { createLineSigner } from '../../infra/line-signer';
import { RevealApiConnector } from '../../infra/reveal/connector';
import { createFanNoteJob } from '../fan-note';
import { createOutboundSender } from '../outbound-sender';

/**
 * `connector.sync_fan_note` (ADR 0117) against FakeReveal's `quiet` world: `fan_01` and his conversation `conv_01`.
 * Every value is invented.
 */

const creatorId = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000bb');
const accountId = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000aa');
const fanId = FanIdSchema.parse('0199f2a0-0000-7000-8000-0000000000dd');
const payload = { creatorId, fanId, correlationId: 'test' };
const logged: { fields: unknown; message: string }[] = [];
const silent = {
  info: (fields: unknown, message: string) => void logged.push({ fields, message }),
  warn: () => undefined,
};

let fakes: FakeReveal[] = [];
afterEach(async () => {
  logged.length = 0;
  await Promise.all(fakes.map((fake) => fake.app.close()));
  fakes = [];
});

class MemoryLines implements NoteLineStore {
  readonly rows = new Map<string, NoteLineMemory>();
  failNext = false;
  lines(): Promise<readonly NoteLineMemory[]> {
    return Promise.resolve([...this.rows.values()]);
  }
  remember(_account: ConnectorAccount, _fan: string, lines: readonly NoteLineMemory[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('database down'));
    }
    for (const line of lines) this.rows.set(line.slot, line);
    return Promise.resolve();
  }
}

async function chatterWrites(fake: FakeReveal, note: string): Promise<void> {
  const response = await fake.app.inject({
    method: 'PATCH',
    url: '/conversations/conv_01/note',
    headers: { authorization: fake.authorization },
    payload: { note },
  });
  expect(response.statusCode).toBe(200);
}

function setUp(writes: boolean) {
  const fake = createFakeReveal({ fixture: 'quiet' });
  fakes.push(fake);
  const patches: string[] = [];
  const connector = new RevealApiConnector({
    session: {
      v: 1,
      bearer: fake.authorization.slice('Bearer '.length),
      userId: fake.userId,
      modelId: fake.modelId,
      userAgent: 'Mozilla/5.0 (test)',
      capturedAt: '2026-10-01T00:00:00.000Z',
    },
    fetch: (url, init) => {
      if (init.method === 'PATCH') patches.push(new URL(url).pathname);
      return fake.fetch(url, init);
    },
    baseUrl: 'https://reveal.test',
    now: () => fake.now(),
    sleep: () => Promise.resolve(),
    sends: new MemorySendJournal(),
  });
  const account: ConnectorAccount = {
    id: accountId,
    creatorId,
    platform: 'reveal',
    sessionState: 'valid',
    lastPollAt: null,
    consecutiveErrors: 0,
    pausedUntil: null,
    config: ConnectorConfigSchema.parse({ writes }),
  };
  const accounts = { get: () => Promise.resolve(account), setSessionState: () => Promise.resolve() };
  const sender = createOutboundSender({
    accounts,
    resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
    clock: { now: () => fake.now() },
  });
  const lines = new MemoryLines();
  let values: NoteSlotValue[] = [];
  const job = createFanNoteJob({
    accounts,
    lines,
    fans: { read: () => Promise.resolve({ platformAccountId: accountId, platformFanId: 'fan_01', values }) },
    writes: sender,
    clock: { now: () => fake.now() },
    signerFor: (id) => createLineSigner([{ version: 'v1', key: Buffer.alloc(32, 7) }], id),
  });
  const note = async () => (await connector.getFanNote({ platform: 'reveal', id: 'fan_01' })).text;
  return {
    fake,
    lines,
    patches,
    note,
    run: async (next: NoteSlotValue[]) => {
      values = next;
      await connector.listConversations({});
      await job(payload, silent);
    },
  };
}

const said = (fake: FakeReveal, slot: NoteSlotValue['slot'], items: string[]): NoteSlotValue => ({
  slot,
  items,
  source: 'declared',
  observedAt: fake.now(),
});

describe('connector.sync_fan_note: his card in his client note (ADR 0117)', () => {
  it('fills the empty canvas lines and keeps the chatter’s other lines', async () => {
    const world = setUp(true);
    await chatterWrites(world.fake, 'Prénom :\nVu au concert (chatteur)');
    await world.run([said(world.fake, 'first_name', ['Testeur']), said(world.fake, 'job', ['boulanger'])]);
    expect(await world.note()).toBe('Prénom : Testeur\nMétier : boulanger\nVu au concert (chatteur)');
    expect([...world.lines.rows.keys()]).toEqual(['first_name', 'job']);
    // Nothing new: nothing written again.
    await world.run([said(world.fake, 'first_name', ['Testeur']), said(world.fake, 'job', ['boulanger'])]);
    expect(world.patches).toHaveLength(1);
  });

  it('corrects a chatter’s value he plainly contradicted, keeping the old one, and stops once the chatter edits it', async () => {
    const world = setUp(true);
    await chatterWrites(world.fake, 'Localisation : Ville A');
    await world.run([said(world.fake, 'location', ['Ville B'])]);
    expect(await world.note()).toBe('Localisation : Ville B (avant : Ville A)');
    await chatterWrites(world.fake, 'Localisation : Ville A');
    await world.run([said(world.fake, 'location', ['Ville C'])]);
    expect(await world.note()).toBe('Localisation : Ville A');
    expect(world.lines.rows.get('location')).toMatchObject({ corrected: true, locked: true });
  });

  it('logs each line written with the source of its value, never the value', async () => {
    const world = setUp(true);
    const noted: NoteSlotValue = {
      slot: 'age',
      items: ['31'],
      source: 'noted',
      observedAt: world.fake.now(),
    };
    await world.run([said(world.fake, 'job', ['boulanger']), noted]);
    const done = logged.find((entry) => entry.message === 'fan note: written');
    expect(done?.fields).toEqual({
      fanId,
      lines: [
        { slot: 'age', source: 'noted' },
        { slot: 'job', source: 'declared' },
      ],
    });
    expect(JSON.stringify(logged)).not.toContain('boulanger');
  });

  it('a write whose memory was lost reads as a human line on the replay: never written again, only completed', async () => {
    const world = setUp(true);
    world.lines.failNext = true;
    await expect(world.run([said(world.fake, 'job', ['boulanger'])])).rejects.toThrow('database down');
    expect(await world.note()).toBe('Métier : boulanger');
    await world.run([said(world.fake, 'job', ['boulanger'])]);
    expect(world.patches).toHaveLength(1);
    expect(world.lines.rows.size).toBe(0);
  });

  it('with the write guard closed, reads nothing and writes nothing', async () => {
    const world = setUp(false);
    await world.run([said(world.fake, 'job', ['boulanger'])]);
    expect(await world.note()).toBe('');
    expect(world.patches).toEqual([]);
    expect(world.lines.rows.size).toBe(0);
  });
});
