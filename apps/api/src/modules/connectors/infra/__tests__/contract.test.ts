import {
  CreatorNoteSchema,
  FanNoteSchema,
  FanPpvStatsSchema,
  FanProfileSchema,
  PlatformScriptSchema,
  SentScriptStepSchema,
  VaultMediaSchema,
} from '@impera/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createFakeReveal } from '../../../../__tests__/fake-reveal/server';
import { ConnectorError, type PlatformConnector } from '../../domain/platform-connector';
import { FakeConnector } from '../fake/FakeConnector';
import { RevealApiConnector } from '../reveal/connector';

import { MemorySendJournal } from './memory-send-journal';

/** The conversation a case names: `a` or `b`. Each subject maps it to one of its own. */
type Key = 'a' | 'b';

/** What a contract case needs: a connector, and a way to make the platform do what a scenario says. */
interface ContractSubject {
  readonly connector: PlatformConnector;
  /** The conversation behind a key, its fan and the name the platform gives him. */
  conversation(key: Key): { readonly id: string; readonly fanId: string; readonly fanDisplayName: string };
  /** The fan writes, a moment after anything said before. */
  fanWrites(key: Key, text: string): Promise<void>;
  /** The next call answers « too many requests ». */
  rateLimitNext(): Promise<void>;
  /** The platform's answers stop matching the shape the adapter knows. */
  changeShape(): Promise<void>;
  /** The next call answers « too many requests », whatever it is. */
  rateLimitAny(): Promise<void>;
  expireSession(): Promise<void>;
  /** Time passes on the platform's clock (the adapter's too). */
  elapse(ms: number): Promise<void>;
  close(): Promise<void>;
}

const FAKE_IDS: Record<Key, string> = { a: 'c-a', b: 'c-b' };

function fakeConnectorSubject(): ContractSubject {
  const fake = new FakeConnector();
  const conversation = (key: Key) => ({
    id: FAKE_IDS[key],
    fanId: `fan-${FAKE_IDS[key]}`,
    fanDisplayName: 'Julien',
  });
  return {
    connector: fake,
    conversation,
    fanWrites: (key, text) => {
      const { id, fanId, fanDisplayName } = conversation(key);
      fake.enqueueInbound({ conversationId: id, fanId, fanDisplayName, text });
      return Promise.resolve();
    },
    rateLimitNext: () => {
      fake.failNext('listConversations', 'rate_limited');
      return Promise.resolve();
    },
    changeShape: () => {
      fake.failNext('listConversations', 'fatal');
      return Promise.resolve();
    },
    rateLimitAny: () => {
      fake.failNext('sendText', 'rate_limited');
      return Promise.resolve();
    },
    expireSession: () => {
      fake.expireSession();
      return Promise.resolve();
    },
    elapse: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

/** `RevealApiConnector` on FakeReveal's `quiet` world: two fans, their conversations, nothing said yet. */
function revealSubject(): ContractSubject {
  const fake = createFakeReveal({ fixture: 'quiet' });
  const control = async (url: string, payload: object): Promise<void> => {
    const response = await fake.app.inject({ method: 'POST', url, payload });
    if (response.statusCode !== 200) throw new Error(`${url}: ${response.body}`);
  };
  const ids: Record<Key, { id: string; fanId: string; fanDisplayName: string }> = {
    a: { id: 'conv_01', fanId: 'fan_01', fanDisplayName: 'Prénom01' },
    b: { id: 'conv_02', fanId: 'fan_02', fanDisplayName: 'Prénom02' },
  };
  return {
    connector: new RevealApiConnector({
      session: {
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      },
      fetch: fake.fetch,
      baseUrl: 'https://reveal.test',
      sleep: () => Promise.resolve(),
      // FakeReveal's clock: an attempt and the message it made are dated alike.
      now: () => fake.now(),
      sends: new MemorySendJournal(),
    }),
    conversation: (key) => ids[key],
    fanWrites: async (key, text) => {
      // FakeReveal's clock moves only when told: each message a second after the last.
      await control('/__clock', { advanceMs: 1_000 });
      await control('/__scenario', { events: [{ type: 'fan_message', conversationId: ids[key].id, text }] });
    },
    rateLimitNext: () =>
      control('/__scenario', { events: [{ type: 'rate_limited', requests: 1, retryAfterSeconds: 7 }] }),
    rateLimitAny: () =>
      control('/__scenario', { events: [{ type: 'rate_limited', requests: 1, retryAfterSeconds: 7 }] }),
    changeShape: () =>
      control('/__scenario', {
        events: [
          { type: 'shape_changed', endpoint: 'conversations.list', rename: { from: 'data', to: 'items' } },
        ],
      }),
    expireSession: () => control('/__scenario', { events: [{ type: 'session_expired' }] }),
    elapse: (ms) => control('/__clock', { advanceMs: ms }),
    close: () => fake.app.close(),
  };
}

/**
 * The port's contract (connectors.md), one suite for every adapter. Reads and writes run against all of them
 * (`RevealApiConnector` sends since P2-03). A new adapter is added here and must pass unchanged.
 */
const READERS: Record<string, () => ContractSubject> = {
  FakeConnector: fakeConnectorSubject,
  'RevealApiConnector + FakeReveal': revealSubject,
};
const WRITERS = READERS;

async function rejection(promise: Promise<unknown>): Promise<ConnectorError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ConnectorError)) throw new Error(`expected a ConnectorError, got ${String(error)}`);
  return error;
}

let open: ContractSubject[] = [];
afterEach(async () => {
  await Promise.all(open.map((subject) => subject.close()));
  open = [];
});

function started<S extends ContractSubject>(make: () => S): S {
  const subject = make();
  open.push(subject);
  return subject;
}

describe.each(Object.entries(READERS))('PlatformConnector contract, reads: %s', (_name, make) => {
  it('reports a valid session and lists conversations, most recent first, with their fan', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    await subject.fanWrites('b', 'Coucou');
    expect(await subject.connector.health()).toBe('valid');
    const conversations = await subject.connector.listConversations({});
    const [a, b] = [subject.conversation('a'), subject.conversation('b')];
    expect(conversations.map((c) => c.ref.id)).toEqual([b.id, a.id]);
    expect(conversations[0]).toMatchObject({ fanRef: { id: b.fanId }, fanDisplayName: b.fanDisplayName });
  });

  it('fetches messages incrementally with `since`', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Un');
    const ref = { platform: subject.connector.platform, id: subject.conversation('a').id };
    const first = await subject.connector.fetchMessages(ref, {});
    expect(first.map((m) => [m.text, m.direction])).toEqual([['Un', 'inbound']]);
    await subject.fanWrites('a', 'Deux');
    const since = new Date(first.at(-1)?.createdAt ?? 0);
    const next = await subject.connector.fetchMessages(ref, { since });
    expect(next.map((m) => m.text)).toEqual(['Deux']);
    expect((await subject.connector.listConversations({ since })).map((c) => c.ref.id)).toEqual([ref.id]);
  });

  it('fails with typed errors only: unknown conversation, rate limit, changed shape', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const missing = await rejection(
      subject.connector.fetchMessages({ platform: subject.connector.platform, id: 'nope' }, {}),
    );
    expect(missing.code).toBe('not_found');
    await subject.rateLimitNext();
    const limited = await rejection(subject.connector.listConversations({}));
    expect(limited.code).toBe('rate_limited');
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    // Nothing was lost: the next call reads normally.
    const listed = await subject.connector.listConversations({});
    expect(listed.map((c) => c.ref.id)).toContain(subject.conversation('a').id);
    await subject.changeShape();
    expect((await rejection(subject.connector.listConversations({}))).code).toBe('fatal');
  });

  it('reports an expired session, and every call then fails with `session_expired`', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    await subject.expireSession();
    expect(await subject.connector.health()).toBe('expired');
    expect((await rejection(subject.connector.listConversations({}))).code).toBe('session_expired');
  });

  it('declares each reading of ADR 0018 by its flag, and a declared one answers in the contract’s shape', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const { connector } = subject;
    const flags = connector.capabilities;
    const fanRef = { platform: connector.platform, id: subject.conversation('a').fanId };
    const conversationRef = { platform: connector.platform, id: subject.conversation('a').id };
    // The fan is known once listed, as the poller lists before anything else.
    await connector.listConversations({});
    const readings = [
      [flags.fanProfile, 'getFanProfile', () => connector.getFanProfile?.(fanRef), FanProfileSchema],
      [flags.fanNoteRead, 'getFanNote', () => connector.getFanNote?.(fanRef), FanNoteSchema],
      [
        flags.creatorNotes,
        'getCreatorNotes',
        () => connector.getCreatorNotes?.(conversationRef),
        z.array(CreatorNoteSchema),
      ],
      [flags.ppvStats, 'getFanPpvStats', () => connector.getFanPpvStats?.(fanRef), FanPpvStatsSchema],
      [
        flags.scripts,
        'listPlatformScripts',
        () => connector.listPlatformScripts?.(),
        z.array(PlatformScriptSchema),
      ],
      [
        flags.scriptHistory,
        'getScriptHistory',
        () => connector.getScriptHistory?.(fanRef),
        z.array(SentScriptStepSchema),
      ],
      [flags.vault, 'listVaultMedia', () => connector.listVaultMedia?.({}), z.array(VaultMediaSchema)],
    ] as const;
    for (const [flag, method, call, schema] of readings) {
      expect(method in connector, method).toBe(flag);
      if (!flag) continue;
      const parsed = schema.safeParse(await call());
      expect(parsed.error).toBeUndefined();
    }
  });
});

describe.each(Object.entries(WRITERS))('PlatformConnector contract, writes: %s', (_name, make) => {
  it('sends idempotently: two calls with one key are one message', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const ref = { platform: subject.connector.platform, id: subject.conversation('a').id };
    const once = await subject.connector.sendText(ref, 'Coucou toi', 'key-1');
    const twice = await subject.connector.sendText(ref, 'Coucou toi', 'key-1');
    expect(twice.messageRef).toEqual(once.messageRef);
    const outbound = (await subject.connector.fetchMessages(ref, {})).filter(
      (m) => m.direction === 'outbound',
    );
    expect(outbound.map((m) => m.text)).toEqual(['Coucou toi']);
  });

  it('verifies a send by its key', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const ref = { platform: subject.connector.platform, id: subject.conversation('a').id };
    expect(await subject.connector.verifySent(ref, 'key-1')).toEqual({ status: 'not_found' });
    const sent = await subject.connector.sendText(ref, 'Coucou', 'key-1');
    expect(await subject.connector.verifySent(ref, 'key-1')).toEqual({
      status: 'sent',
      messageRef: sent.messageRef,
    });
  });

  it('a failed send sent nothing: the same key goes through a minute later', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const ref = { platform: subject.connector.platform, id: subject.conversation('a').id };
    await subject.rateLimitAny();
    const limited = await rejection(subject.connector.sendText(ref, 'Coucou', 'key-1'));
    expect(limited.code).toBe('rate_limited');
    expect(await subject.connector.verifySent(ref, 'key-1')).toEqual({ status: 'not_found' });
    // An adapter may hold a retry back while the platform could still list the first attempt (Reveal: 30 s).
    await subject.elapse(60_000);
    await subject.connector.sendText(ref, 'Coucou', 'key-1');
  });

  it('declares each write of ADR 0018 by its flag, and a declared one goes through', async () => {
    const subject = started(make);
    await subject.fanWrites('a', 'Salut');
    const { connector } = subject;
    const flags = connector.capabilities;
    const conversationRef = { platform: connector.platform, id: subject.conversation('a').id };
    const fanRef = { platform: connector.platform, id: subject.conversation('a').fanId };
    await connector.listConversations({});
    expect('setFanNote' in connector, 'setFanNote').toBe(flags.fanNoteWrite);
    expect('markRead' in connector, 'markRead').toBe(flags.markRead);
    expect('setTyping' in connector, 'setTyping').toBe(flags.typing);
    if (flags.fanNoteWrite) {
      await connector.setFanNote?.(fanRef, 'Prénom : Julien', 'note-1');
      if (flags.fanNoteRead) expect((await connector.getFanNote?.(fanRef))?.text).toContain('Julien');
    }
    if (flags.markRead) await connector.markRead?.(conversationRef);
    if (flags.typing) await connector.setTyping?.(conversationRef, true);
    if (flags.scripts) {
      const [script] = (await connector.listPlatformScripts?.()) ?? [];
      if (script === undefined) throw new Error('a platform that declares scripts lists one');
      const [first] = script.steps;
      if (first === undefined) throw new Error('a platform script has a step');
      const price = { amountMinor: first.priceMinor, currency: first.currency };
      const sent = await connector.sendScriptStep?.(conversationRef, script.ref, 0, price, 'step-1');
      const again = await connector.sendScriptStep?.(conversationRef, script.ref, 0, price, 'step-1');
      expect(again?.messageRef).toEqual(sent?.messageRef);
      if (flags.scriptHistory) {
        const history = (await connector.getScriptHistory?.(fanRef)) ?? [];
        expect(history.map((step) => step.stepRef)).toContainEqual(first.ref);
      }
    }
  });
});
