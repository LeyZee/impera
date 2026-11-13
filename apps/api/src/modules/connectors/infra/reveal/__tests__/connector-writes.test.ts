import { afterEach, describe, expect, it } from 'vitest';

import { REVEAL_EXPECTED_CAPABILITIES } from '../../../../../__tests__/fake-reveal/model';
import { createFakeReveal, type FakeReveal } from '../../../../../__tests__/fake-reveal/server';
import { ConnectorError, ScriptStepAlreadySent } from '../../../domain/platform-connector';
import type { ConnectorSend, SendJournal } from '../../../domain/ports';
import { MemorySendJournal } from '../../__tests__/memory-send-journal';
import type { RevealFetch } from '../client';
import { RevealApiConnector } from '../connector';

/**
 * `RevealApiConnector`'s writes (reveal-connector-spec.md § 5, P2-03) against FakeReveal's `quiet` world: two fans
 * (`fan_01`, `fan_02`) and their conversations, nothing said yet, 4 sequences of 3 steps at 5, 15 and 30 €, a voice
 * note in the vault. Everything is invented. The connector reads FakeReveal's clock, so an attempt and the message it
 * made are dated alike.
 */

const BASE = 'https://reveal.test';

let fakes: FakeReveal[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((fake) => fake.app.close()));
  fakes = [];
});

function world(): FakeReveal {
  const fake = createFakeReveal({ fixture: 'quiet' });
  fakes.push(fake);
  return fake;
}

/** Every call that reached FakeReveal: method and path. */
interface Spied {
  readonly calls: string[];
  readonly bodies: unknown[];
  readonly fetch: RevealFetch;
}

function spy(fake: FakeReveal, refuse?: (method: string, url: URL) => boolean): Spied {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  return {
    calls,
    bodies,
    fetch: async (url, init) => {
      const target = new URL(url);
      calls.push(`${init.method} ${target.pathname}`);
      if (init.body !== undefined) bodies.push(JSON.parse(init.body));
      if (refuse?.(init.method, target) === true) {
        return { status: 500, headers: { get: () => null }, text: () => Promise.resolve('{}') };
      }
      return fake.fetch(url, init);
    },
  };
}

function connect(
  fake: FakeReveal,
  extra: {
    sends?: SendJournal | null;
    fetch?: RevealFetch;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): RevealApiConnector {
  const sends = extra.sends === undefined ? new MemorySendJournal() : extra.sends;
  return new RevealApiConnector({
    session: {
      v: 1,
      bearer: fake.authorization.slice('Bearer '.length),
      userId: fake.userId,
      modelId: fake.modelId,
      userAgent: 'Mozilla/5.0 (test)',
      capturedAt: '2026-10-01T00:00:00.000Z',
    },
    fetch: extra.fetch ?? fake.fetch,
    baseUrl: BASE,
    now: extra.now ?? (() => fake.now()),
    sleep: extra.sleep ?? (() => Promise.resolve()),
    ...(sends === null ? {} : { sends }),
  });
}

const ref = (id: string) => ({ platform: 'reveal' as const, id });
const posts = (spied: Spied) => spied.calls.filter((call) => call.startsWith('POST '));

async function scenario(fake: FakeReveal, events: object[]): Promise<void> {
  const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
  expect(response.statusCode).toBe(200);
}

async function rejection(promise: Promise<unknown>): Promise<ConnectorError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ConnectorError)) throw new Error(`expected a ConnectorError, got ${String(error)}`);
  return error;
}

/** The messages FakeReveal holds in a conversation, oldest first. */
function thread(fake: FakeReveal, conversationId: string) {
  return fake.state().messages.filter((message) => message.conversationId === conversationId);
}

describe('RevealApiConnector: sending (spec § 5)', () => {
  it('declares every capability Reveal allows, the writes included', () => {
    expect(connect(world()).capabilities).toEqual(REVEAL_EXPECTED_CAPABILITIES);
  });

  it('sends a text as the official client does, records it first, and knows it as its own afterwards', async () => {
    const fake = world();
    const spied = spy(fake);
    const sends = new MemorySendJournal();
    const connector = connect(fake, { fetch: spied.fetch, sends });
    const sent = await connector.sendText(ref('conv_01'), 'Coucou toi', 'key-1');
    expect(spied.bodies).toEqual([
      { message: { content: 'Coucou toi', isUnread: true }, mediaIds: [], files: [] },
    ]);
    const row = sends.rows.get('key-1');
    expect(row).toMatchObject({ platformConversationId: 'conv_01', platformMessageId: sent.messageRef.id });
    expect(row?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(row)).not.toContain('Coucou');
    await scenario(fake, [{ type: 'fan_message', conversationId: 'conv_01', text: 'Salut' }]);
    // A chatter writes from the dashboard: outbound, not ours.
    await fake.app.inject({
      method: 'POST',
      url: '/conversations/conv_01/messages',
      headers: { authorization: fake.authorization },
      payload: { message: { content: 'Je reprends', isUnread: true }, mediaIds: [], files: [] },
    });
    const messages = await connector.fetchMessages(ref('conv_01'), {});
    expect(messages.map((m) => [m.text, m.author])).toEqual(
      expect.arrayContaining([
        ['Coucou toi', 'ai'],
        ['Salut', 'fan'],
        ['Je reprends', 'human'],
      ]),
    );
  });

  it('sends once per key: a second call answers the first message, another content under it is refused', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    const once = await connector.sendText(ref('conv_01'), 'Coucou', 'key-1');
    const twice = await connector.sendText(ref('conv_01'), 'Coucou', 'key-1');
    expect(twice.messageRef).toEqual(once.messageRef);
    expect(posts(spied)).toHaveLength(1);
    expect((await rejection(connector.sendText(ref('conv_02'), 'Coucou', 'key-1'))).code).toBe('fatal');
    expect(posts(spied)).toHaveLength(1);
    expect(thread(fake, 'conv_01')).toHaveLength(1);
  });

  it('« envoi accepté puis coupure »: the answer is lost, the retry finds the message and sends nothing', async () => {
    const fake = world();
    const spied = spy(fake);
    const sends = new MemorySendJournal();
    const connector = connect(fake, { fetch: spied.fetch, sends });
    await scenario(fake, [{ type: 'send_answer_lost', times: 1 }]);
    expect((await rejection(connector.sendText(ref('conv_01'), 'Tu es là ?', 'key-1'))).code).toBe(
      'transient',
    );
    expect(sends.rows.get('key-1')?.platformMessageId).toBeNull();
    const [taken] = thread(fake, 'conv_01');
    expect(await connector.verifySent(ref('conv_01'), 'key-1')).toEqual({
      status: 'sent',
      messageRef: ref(taken?.id ?? ''),
    });
    const retried = await connector.sendText(ref('conv_01'), 'Tu es là ?', 'key-1');
    expect(retried.messageRef.id).toBe(taken?.id);
    expect(posts(spied)).toHaveLength(1);
    expect(thread(fake, 'conv_01')).toHaveLength(1);
  });

  it('a process killed between Reveal taking the message and our record of it: the retry never sends twice', async () => {
    const fake = world();
    const spied = spy(fake);
    const journal = new MemorySendJournal();
    // The first process records the attempt, Reveal takes the message, and the process dies before the id is kept.
    const dying: SendJournal = {
      find: (key) => journal.find(key),
      begin: (send) => journal.begin(send),
      settle: () => Promise.reject(new Error('killed')),
      ownIds: (conversationId, ids) => journal.ownIds(conversationId, ids),
    };
    await expect(
      connect(fake, { fetch: spied.fetch, sends: dying }).sendText(ref('conv_01'), 'Bonne nuit', 'key-1'),
    ).rejects.toThrow('killed');
    expect(journal.rows.get('key-1')?.platformMessageId).toBeNull();
    expect(thread(fake, 'conv_01')).toHaveLength(1);
    // The job is replayed by a new process: same key, a fresh connector.
    const replay = await connect(fake, { fetch: spied.fetch, sends: journal }).sendText(
      ref('conv_01'),
      'Bonne nuit',
      'key-1',
    );
    expect(replay.messageRef.id).toBe(thread(fake, 'conv_01')[0]?.id);
    expect(journal.rows.get('key-1')?.platformMessageId).toBe(replay.messageRef.id);
    expect(posts(spied)).toHaveLength(1);
    expect(thread(fake, 'conv_01')).toHaveLength(1);
  });

  it('verifies by key: never tried, refused before Reveal took it, or taken', async () => {
    const fake = world();
    const connector = connect(fake);
    expect(await connector.verifySent(ref('conv_01'), 'key-1')).toEqual({ status: 'not_found' });
    await scenario(fake, [{ type: 'rate_limited', requests: 1, retryAfterSeconds: 5 }]);
    expect((await rejection(connector.sendText(ref('conv_01'), 'Coucou', 'key-1'))).code).toBe(
      'rate_limited',
    );
    expect(await connector.verifySent(ref('conv_01'), 'key-1')).toEqual({ status: 'not_found' });
    const sent = await connector.sendText(ref('conv_01'), 'Coucou', 'key-1');
    expect(await connector.verifySent(ref('conv_01'), 'key-1')).toEqual({
      status: 'sent',
      messageRef: sent.messageRef,
    });
    expect(await connector.verifySent(ref('conv_02'), 'key-1')).toEqual({ status: 'not_found' });
  });

  it('keeps its own pace: 20 sends a minute per account, 2 s between two sends of one conversation', async () => {
    const fake = world();
    const spied = spy(fake);
    let now = fake.now().getTime();
    const waits: number[] = [];
    const connector = connect(fake, {
      fetch: spied.fetch,
      now: () => new Date(now),
      sleep: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await connector.sendText(ref('conv_01'), 'Un', 'k-0');
    await connector.sendText(ref('conv_01'), 'Deux', 'k-1');
    expect(waits).toEqual([2_000]);
    for (let i = 2; i < 20; i++) {
      now += 2_001;
      await connector.sendText(
        ref(i % 2 === 0 ? 'conv_02' : 'conv_01'),
        `Message ${String(i)}`,
        `k-${String(i)}`,
      );
    }
    expect(waits).toEqual([2_000]);
    const limited = await rejection(connector.sendText(ref('conv_02'), 'Vingt et un', 'k-20'));
    expect(limited.code).toBe('rate_limited');
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(posts(spied)).toHaveLength(20);
    now += 60_000;
    await connector.sendText(ref('conv_02'), 'Vingt et un', 'k-20');
    expect(posts(spied)).toHaveLength(21);
  });

  it('refuses every write without a send journal, before calling Reveal', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch, sends: null });
    expect((await rejection(connector.sendText(ref('conv_01'), 'Coucou', 'k'))).code).toBe('fatal');
    expect(spied.calls).toEqual([]);
  });
});

describe('RevealApiConnector: script steps (spec §§ 5, 6; ADR 0018 § 5)', () => {
  it('sends a step with its bundle as scripts.list gives it, then refuses it for good in that conversation', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    const sent = await connector.sendScriptStep(ref('conv_01'), ref('sequence_1'), 1, 'step-1');
    expect(spied.bodies).toEqual([
      {
        scriptId: 'script_1_2',
        message: { content: 'Coucou %NAME%, étape 2 du script 1', isUnread: true },
        bundle: {
          type: 'media',
          price: 1500,
          mediaIds: ['media_02'],
          files: [],
          teasingMediaIds: ['media_09'],
          teasingFiles: [],
        },
      },
    ]);
    const [message] = thread(fake, 'conv_01');
    expect(message).toMatchObject({ id: sent.messageRef.id, scriptId: 'script_1_2' });
    expect(message?.bundle?.priceCents).toBe(1500);
    // The same key again: the same message, no refusal and no send.
    expect(
      (await connector.sendScriptStep(ref('conv_01'), ref('sequence_1'), 1, 'step-1')).messageRef,
    ).toEqual(sent.messageRef);
    // Another key for the same step: Reveal's history says it went, nothing is sent.
    const before = posts(spied).length;
    const refused = await connector
      .sendScriptStep(ref('conv_01'), ref('sequence_1'), 1, 'step-2')
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ScriptStepAlreadySent);
    expect(posts(spied)).toHaveLength(before);
    // Already sent to fan 01 is not already sent to fan 02.
    await connector.sendScriptStep(ref('conv_02'), ref('sequence_1'), 1, 'step-3');
    expect(thread(fake, 'conv_02')).toHaveLength(1);
  });

  it('a step whose answer was lost is found again by the retry, though Reveal filled its %NAME%', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    await scenario(fake, [{ type: 'send_answer_lost', times: 1 }]);
    await rejection(connector.sendScriptStep(ref('conv_01'), ref('sequence_2'), 0, 'step-1'));
    expect(thread(fake, 'conv_01')[0]?.content).toBe('Coucou Prénom01, étape 1 du script 2');
    const retried = await connector.sendScriptStep(ref('conv_01'), ref('sequence_2'), 0, 'step-1');
    expect(retried.messageRef.id).toBe(thread(fake, 'conv_01')[0]?.id);
    expect(posts(spied)).toHaveLength(1);
  });

  it('sends nothing when the history cannot be read, nor for a step that does not exist', async () => {
    const fake = world();
    const spied = spy(
      fake,
      (method, url) => method === 'GET' && url.searchParams.get('conversationId') !== null,
    );
    const connector = connect(fake, { fetch: spied.fetch });
    expect((await rejection(connector.sendScriptStep(ref('conv_01'), ref('sequence_1'), 0, 'k'))).code).toBe(
      'transient',
    );
    expect(
      (await rejection(connect(fake).sendScriptStep(ref('conv_01'), ref('sequence_1'), 3, 'k2'))).code,
    ).toBe('not_found');
    expect(posts(spied)).toEqual([]);
    expect(thread(fake, 'conv_01')).toEqual([]);
  });
});

describe('RevealApiConnector: voice note, client note, read mark, typing (spec § 5)', () => {
  it('sends one free voice note of the vault, and refuses any other media before calling Reveal', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    const media = (ids: string[], priceMinor: number | null = null) => ({
      mediaRefs: ids.map(ref),
      text: '',
      priceMinor,
      currency: null,
    });
    await connector.sendMedia(ref('conv_01'), media(['media_voice_01']), 'voice-1');
    expect(spied.bodies).toEqual([
      { message: { content: '', isUnread: true }, mediaIds: ['media_voice_01'], files: [] },
    ]);
    expect(thread(fake, 'conv_01')[0]?.mediaIds).toEqual(['media_voice_01']);
    for (const [refused, key] of [
      [media(['media_01']), 'photo'],
      [media(['media_voice_01', 'media_01']), 'two'],
      [media(['media_voice_01'], 500), 'priced'],
    ] as const) {
      expect((await rejection(connector.sendMedia(ref('conv_01'), refused, key))).code).toBe('fatal');
    }
    expect(posts(spied)).toHaveLength(1);
  });

  it('writes the agency’s canvas lines into the note read just before, keeping every other line', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    await connector.listConversations({});
    await connector.setFanNote(ref('fan_01'), 'Prénom : Prénom01\nÂge : 31');
    expect(await connector.getFanNote(ref('fan_01'))).toEqual({ text: 'Prénom : Prénom01\nÂge : 31' });
    // A chatter writes in between: his line stays, the agency's line changes in place.
    await fake.app.inject({
      method: 'PATCH',
      url: '/conversations/conv_01/note',
      headers: { authorization: fake.authorization },
      payload: { note: 'Prénom : Prénom01\nÂge : 31\nVu au concert (chatteur)' },
    });
    await connector.setFanNote(ref('fan_01'), 'Âge : 32\nMétier : boulanger');
    expect((await connector.getFanNote(ref('fan_01'))).text).toBe(
      'Prénom : Prénom01\nÂge : 32\nMétier : boulanger\nVu au concert (chatteur)',
    );
    const patches = () => spied.calls.filter((call) => call.startsWith('PATCH ')).length;
    expect(patches()).toBe(2);
    // The same block again changes nothing: nothing is written.
    await connector.setFanNote(ref('fan_01'), 'Âge : 32\nMétier : boulanger');
    expect(patches()).toBe(2);
    // A line out of the canvas is not the agency's to write.
    expect((await rejection(connector.setFanNote(ref('fan_01'), 'Vu au concert'))).code).toBe('fatal');
    expect(patches()).toBe(2);
  });

  it('marks a conversation read, and types while asked to', async () => {
    const fake = world();
    const spied = spy(fake);
    const connector = connect(fake, { fetch: spied.fetch });
    await scenario(fake, [{ type: 'fan_message', conversationId: 'conv_01', text: 'Salut' }]);
    await connector.markRead(ref('conv_01'));
    expect(fake.state().conversations.find((c) => c.id === 'conv_01')?.modelIsUnread).toBe(false);
    await connector.setTyping(ref('conv_01'), true);
    await connector.setTyping(ref('conv_01'), false);
    expect(spied.calls).toEqual(['PATCH /conversations/conv_01/read', 'POST /conversations/conv_01/typing']);
  });
});

describe('RevealApiConnector: a whole visit on FakeReveal (P2-03, critère d’acceptation)', () => {
  it('list → conversation → profile and note → scripts and steps sent → text, step, voice, note → read back', async () => {
    const fake = world();
    const sends = new MemorySendJournal();
    const connector = connect(fake, { sends });
    await scenario(fake, [{ type: 'fan_message', conversationId: 'conv_02', text: 'Coucou' }]);
    const [conversation] = await connector.listConversations({});
    expect(conversation?.fanRef.id).toBe('fan_02');
    const conversationRef = ref('conv_02');
    const fanRef = ref('fan_02');
    expect((await connector.fetchMessages(conversationRef, {})).map((m) => m.author)).toEqual(['fan']);
    expect((await connector.getFanProfile(fanRef)).fanRef).toEqual(fanRef);
    expect(await connector.getFanNote(fanRef)).toEqual({ text: '' });
    const scripts = await connector.listPlatformScripts();
    expect(scripts.length).toBeGreaterThan(0);
    expect(await connector.getScriptHistory(fanRef)).toEqual([]);

    await connector.sendText(conversationRef, 'Coucou toi', 'visit-text');
    await connector.sendScriptStep(conversationRef, ref('sequence_3'), 0, 'visit-step');
    await connector.sendMedia(
      conversationRef,
      { mediaRefs: [ref('media_voice_01')], text: '', priceMinor: null, currency: null },
      'visit-voice',
    );
    await connector.setFanNote(fanRef, 'Prénom : Prénom02');

    const read = await connector.fetchMessages(conversationRef, {});
    expect(read.map((m) => [m.author, m.priceMinor])).toEqual([
      ['fan', null],
      ['ai', null],
      ['ai', 500],
      ['ai', null],
    ]);
    expect(read[3]?.media.map((media) => media.kind)).toEqual(['audio']);
    expect(await connector.getScriptHistory(fanRef)).toEqual([{ stepRef: ref('script_3_1'), isPaid: false }]);
    expect(await connector.getFanNote(fanRef)).toEqual({ text: 'Prénom : Prénom02' });
    const recorded: ConnectorSend[] = [...sends.rows.values()];
    expect(recorded.map((send) => send.platformMessageId)).toEqual(read.slice(1).map((m) => m.ref.id));
  });
});
