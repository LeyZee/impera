import {
  ConnectorConfigSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeReveal, type FakeReveal } from '../../../../__tests__/fake-reveal/server';
import { SendRefused } from '../../../conversations';
import { ConnectorUnavailable } from '../../domain/errors';
import type { PlatformConnector } from '../../domain/platform-connector';
import type { ConnectorAccount } from '../../domain/ports';
import { MemorySendJournal } from '../../infra/__tests__/memory-send-journal';
import { FakeConnector } from '../../infra/fake/FakeConnector';
import { RevealApiConnector } from '../../infra/reveal/connector';
import { createOutboundSender } from '../outbound-sender';

/**
 * The write guard (ADR 0018 § 3) in front of every write of the port, sends and ADR 0018's writes alike: with
 * `writes: false`, nothing reaches the platform, whatever the method. Against FakeReveal's `quiet` world (invented).
 */

const creatorId = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000bb');
const accountId = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000aa');
const conversation = {
  id: ConversationIdSchema.parse('0199f2a0-0000-7000-8000-0000000000cc'),
  creatorId,
  platformAccountId: accountId,
  fanId: FanIdSchema.parse('0199f2a0-0000-7000-8000-0000000000dd'),
  platformConversationId: 'conv_01',
};

let fakes: FakeReveal[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((fake) => fake.app.close()));
  fakes = [];
});

function senderOn(writes: boolean, connectorOf?: (fake: FakeReveal) => PlatformConnector) {
  const fake = createFakeReveal({ fixture: 'quiet' });
  fakes.push(fake);
  const calls: string[] = [];
  const connector =
    connectorOf?.(fake) ??
    new RevealApiConnector({
      session: {
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      },
      fetch: (url, init) => {
        calls.push(`${init.method} ${new URL(url).pathname}`);
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
  const sender = createOutboundSender({
    accounts: {
      get: () => Promise.resolve(account),
      setSessionState: () => Promise.resolve(),
    },
    resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
    clock: { now: () => fake.now() },
  });
  return { sender, calls, fake };
}

const scriptRef = { platform: 'reveal' as const, id: 'sequence_1' };
/** The first step's price in the `quiet` world, as validated. */
const price = { amountMinor: 500, currency: 'EUR' as const };

describe('outbound sender: the write guard before every write (ADR 0018 § 3)', () => {
  it('`writes: false` refuses each write before any call to the platform', async () => {
    const { sender, calls, fake } = senderOn(false);
    const writes: [string, () => Promise<unknown>][] = [
      ['sendText', () => sender.sendText(conversation, 'Coucou', 'k1')],
      [
        'sendMedia',
        () =>
          sender.sendMedia(
            conversation,
            {
              mediaRefs: [{ platform: 'reveal', id: 'media_voice_01' }],
              text: '',
              priceMinor: null,
              currency: null,
            },
            'k2',
          ),
      ],
      ['sendScriptStep', () => sender.sendScriptStep(conversation, scriptRef, 0, price, 'k3')],
      ['setFanNote', () => sender.setFanNote(conversation, 'fan_01', 'Prénom : Prénom01', 'k4')],
      ['markRead', () => sender.markRead(conversation)],
      ['setTyping', () => sender.setTyping(conversation, true)],
    ];
    for (const [method, write] of writes) {
      const error: unknown = await write().catch((reason: unknown) => reason);
      expect(error, method).toBeInstanceOf(SendRefused);
      expect(error, method).toMatchObject({ code: 'connector_writes_disabled' });
    }
    expect(calls).toEqual([]);
    expect(fake.state().messages).toEqual([]);
    // Reading what was sent is not a write.
    expect(await sender.verifySent(conversation, 'k1', null)).toEqual({ status: 'not_found' });
  });

  it('`writes: true` lets each write through; a step already sent is refused for good, without a send', async () => {
    const { sender, calls, fake } = senderOn(true);
    await sender.sendText(conversation, 'Coucou', 'k1');
    await sender.sendScriptStep(conversation, scriptRef, 0, price, 'k2');
    await sender.setFanNote(conversation, 'fan_01', 'Prénom : Prénom01', 'k3');
    await sender.markRead(conversation);
    await sender.setTyping(conversation, true);
    expect(fake.state().messages).toHaveLength(2);
    const posts = calls.filter((call) => call.startsWith('POST /conversations/conv_01/messages')).length;
    const error: unknown = await sender
      .sendScriptStep(conversation, scriptRef, 0, price, 'k4')
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SendRefused);
    expect(error).toMatchObject({ code: 'script_step_already_sent' });
    expect(calls.filter((call) => call.startsWith('POST /conversations/conv_01/messages'))).toHaveLength(
      posts,
    );
  });

  it('a step whose price changed on the platform since it was validated is refused, without a send', async () => {
    const { sender, calls, fake } = senderOn(true);
    await fake.app.inject({
      method: 'POST',
      url: '/__scenario',
      payload: { events: [{ type: 'script_changed', scriptId: 'script_1_1', priceCents: 900 }] },
    });
    const error: unknown = await sender
      .sendScriptStep(conversation, scriptRef, 0, price, 'k1')
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SendRefused);
    expect(error).toMatchObject({ code: 'script_price_changed' });
    expect(calls.filter((call) => call.startsWith('POST '))).toEqual([]);
    expect(fake.state().messages).toEqual([]);
  });

  it('a write the connector does not declare is `ConnectorUnavailable`, never tried', async () => {
    const fakeConnector = new FakeConnector();
    const { sender } = senderOn(true, () => fakeConnector);
    for (const write of [
      () => sender.sendScriptStep(conversation, scriptRef, 0, price, 'k1'),
      () => sender.setFanNote(conversation, 'fan_01', 'Prénom : Julien', 'k2'),
      () => sender.markRead(conversation),
      () => sender.setTyping(conversation, true),
    ]) {
      expect(await write().catch((reason: unknown) => reason)).toBeInstanceOf(ConnectorUnavailable);
    }
  });
});
