import { randomBytes } from 'node:crypto';

import type { PlatformAccountId } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import type { Brief } from '@impera/llm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { App } from '../../composition-root';
import type { ScriptSource } from '../../modules/agent';
import { revealApiConnectors } from '../../modules/connectors';
import { createFakeReveal, type FakeReveal } from '../fake-reveal/server';
import { startJourney, type Journey } from '../support/agent-journey';
import { BRIEF } from '../support/llm';
import { DEMO_PERSONA } from '../support/persona';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
/** FakeReveal's `quiet` world: her script 4, its first step at 5 €, and the fan of `conv_01`. */
const SEQUENCE = 'sequence_4';
const STEPS = ['script_4_1', 'script_4_2'] as const;
const FIRST_STEP_MINOR = 500;
const THREAD = 'conv_01';
const FAN = 'fan_01';

/** The demo persona, with a script launch any hot fan reaches at once (her desire floor, no wait to sexualize). */
const SELLING = {
  ...DEMO_PERSONA,
  strategies: {
    ...DEMO_PERSONA.strategies,
    kyc: { ...DEMO_PERSONA.strategies.kyc, min_hours_before_following: 0 },
    sexualization: { ...DEMO_PERSONA.strategies.sexualization, initiate_after_hours: 0 },
    script_launch: { ...DEMO_PERSONA.strategies.script_launch, cooldown_hours: 12, min_desire: 50 },
  },
};

/** He is alone, free and hot, and the brain picks her one script (`s1`). */
const HOT: Brief = {
  ...BRIEF,
  intent: 'sexting',
  sentiment: 'aroused',
  action: 'offer',
  replyBrief: 'Lui proposer son script.',
  scriptPick: 's1',
  desireSignals: ['alone', 'free_now', 'states_desire', 'explicit_language', 'steers_to_intimate'],
};

/**
 * Her catalogue as the agent reads it: the copy of script 4 on Reveal, at Reveal's prices. His history and his last
 * offer are read on FakeReveal by the real connector, as in production.
 */
function sales(app: App, accountId: PlatformAccountId) {
  const reads = app.modules.connectors.platformReads;
  const scripts: ScriptSource = {
    catalogue: () =>
      Promise.resolve([
        {
          scriptRef: SEQUENCE,
          moment: null,
          description: 'Script de démonstration',
          steps: [
            { stepRef: STEPS[0], kind: 'paid', priceMinor: FIRST_STEP_MINOR, mediaRefs: [] },
            { stepRef: STEPS[1], kind: 'paid', priceMinor: 1_500, mediaRefs: [] },
          ],
          mediaValidated: true,
          descriptionValidated: true,
          touchesLimits: false,
        },
      ]),
    history: async () => {
      const sent = await reads.scriptHistory(accountId, FAN);
      const indexes = (bought: boolean) =>
        STEPS.flatMap((ref, index) =>
          sent.some((step) => step.stepRef.id === ref && (!bought || step.purchased)) ? [index] : [],
        );
      const sentIndexes = indexes(false);
      return {
        scripts:
          sentIndexes.length === 0
            ? []
            : [{ scriptRef: SEQUENCE, sentStepIndexes: sentIndexes, boughtStepIndexes: indexes(true) }],
      };
    },
  };
  return { scripts, lastOfferAt: () => reads.lastOfferAt(accountId, FAN) };
}

/**
 * A script sold by the agent, from his message to FakeReveal (audit IA, trou 3): the offer decided by code on the real
 * composer, the step at its catalogue price approved by a human, sent once through the real Reveal connector even when
 * the send job runs again, and nothing sold again once he says no.
 */
describe('a script sold by the agent, to FakeReveal', () => {
  let journey: Journey;
  let fake: FakeReveal;

  const sends = async () => {
    const result = await journey.test.admin.db.execute(
      sql`select idempotency_key, state from connector_sends where platform_account_id = ${journey.accountId}`,
    );
    return z.array(z.object({ idempotency_key: z.string(), state: z.string() })).parse(result.rows);
  };
  const offers = async (id: Parameters<Journey['journal']>[0]) =>
    (await journey.journal(id)).filter((event) => event.type === 'offer_made').map((event) => event.payload);
  const bundles = () => fake.state().messages.filter((message) => message.bundle !== null);

  beforeAll(async () => {
    fake = createFakeReveal({ fixture: 'quiet' });
    journey = await startJourney({
      start: new Date(fake.now()),
      persona: SELLING,
      handle: 'creatrice_test',
      config: { SESSION_ENCRYPTION_KEYS: SESSION_KEYS },
      appOptions: {
        connectorsClock: () => fake.now(),
        connectorRegistry: {
          reveal: revealApiConnectors({
            fetch: fake.fetch,
            baseUrl: 'https://reveal.test',
            now: () => fake.now(),
          }),
        },
      },
      sender: (app) => app.modules.connectors.outboundSender,
      sales,
    });
    await journey.app.modules.connectors.sessions.store({
      platformAccountId: journey.accountId,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
    await journey.test.admin.db
      .update(schema.platformAccounts)
      .set({ connectorConfig: { writes: true } })
      .where(eq(schema.platformAccounts.id, journey.accountId));
  });

  afterAll(async () => {
    await journey.close();
    await fake.app.close();
  });

  it('offers her step at its price, sends it once on Reveal, and sells nothing again once he says no', async () => {
    journey.models({ brief: HOT, voice: { bubbles: ['J’ai un petit truc rien que pour toi 😏'] } });
    const id = await journey.fanWrites(THREAD, 'je suis seul chez moi, j’ai trop envie de toi', FAN);
    const { fanId } = await journey.state(id);
    // A human confirmed him an adult before: nothing is sold to a fan whose age is not.
    const confirmed = await journey.asOwner('PUT', `/v1/fans/${fanId}/flags?creatorId=${journey.creatorId}`, {
      flag: 'ageConfirmedAt',
      set: true,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    await journey.respond(id);

    // The code opened her script on its first step, at the catalogue's price: the offer and the draft say so.
    const [draft] = await journey.drafts(id);
    if (draft === undefined) throw new Error('no draft');
    expect(draft.policyTrace).toMatchObject({
      scriptStep: { scriptRef: SEQUENCE, stepIndex: 0, stepRef: STEPS[0], priceMinor: FIRST_STEP_MINOR },
    });
    expect(await offers(id)).toEqual([{ amountMinor: FIRST_STEP_MINOR, currency: 'EUR' }]);
    expect(bundles()).toEqual([]);

    // A human approves it; the send job runs, then runs again (a retry after a crash): one step on Reveal.
    await journey.approve(id, draft.id);
    await journey.send(id, draft.id, 1);
    await journey.send(id, draft.id, 2);
    expect(bundles().map((message) => [message.conversationId, message.bundle?.priceCents])).toEqual([
      [THREAD, FIRST_STEP_MINOR],
    ]);
    expect(
      fake
        .state()
        .messages.filter((message) => message.content === 'J’ai un petit truc rien que pour toi 😏'),
    ).toHaveLength(1);
    const keys = (await sends()).map((send) => send.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect((await sends()).every((send) => send.state === 'sent')).toBe(true);

    // He says no; the brain would sell again: the code does not, neither now nor at his next message.
    journey.models({
      brief: { ...HOT, scriptReply: 'refused' },
      voice: { bubbles: ['Pas de souci, on discute alors'] },
    });
    journey.clock.advance(5 * 60_000);
    await journey.fanWrites(THREAD, 'non merci pas ce soir', FAN);
    await journey.respond(id);
    journey.models({ brief: HOT, voice: { bubbles: ['Tu fais quoi de beau ?'] } });
    journey.clock.advance(5 * 60_000);
    await journey.fanWrites(THREAD, 'et sinon tu fais quoi', FAN);
    await journey.respond(id);

    expect((await journey.journal(id)).map((event) => event.type)).toContain('script_step_refused');
    expect(await offers(id)).toHaveLength(1);
    const later = (await journey.drafts(id)).slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const each of later) expect(each.policyTrace).not.toHaveProperty('scriptStep');
    expect(bundles()).toHaveLength(1);
  });
});
