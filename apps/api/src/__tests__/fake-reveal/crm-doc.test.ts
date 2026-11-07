import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  createFakeCrm,
  FAKE_CRM_KEY,
  revealSignature,
  type DeliverWebhook,
  type FakeCrmOptions,
} from './crm';
import { TRACKING_LINKS } from './crm-tracking';

/**
 * FakeReveal held to Reveal's « CRM / API » documentation (read 2026-11-06): the errors, the limits, the tracking links,
 * the statistics per type of sale, the key's scope, and the webhooks with their deliveries. The adapter's own tests
 * (`crm.test.ts`) read it through Impera's code; these read it as the documentation describes it.
 */

const OTHER_KEY = 'rvl_fake_other_key';

function world(options: FakeCrmOptions = {}) {
  let at = Date.parse('2026-11-06T12:00:00.000Z');
  const crm = createFakeCrm({
    acceptKey: (key) => key === FAKE_CRM_KEY || key === OTHER_KEY,
    now: () => new Date(at),
    ...options,
  });
  const get = (url: string, key = FAKE_CRM_KEY) =>
    crm.app.inject({ method: 'GET', url, headers: { 'x-api-key': key } });
  const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: object, key = FAKE_CRM_KEY) =>
    crm.app.inject({
      method,
      url,
      headers: { 'x-api-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const advance = (seconds: number) => {
    at += seconds * 1000;
  };
  return { crm, get, send, advance };
}

const WebhookSchema = z.object({ id: z.string(), secret: z.string().optional() });
const DeliveriesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      attempts: z.number(),
      nextAttemptAt: z.string().nullable(),
    }),
  ),
});

describe('FakeReveal answers like the documentation', () => {
  it('refuses bad ranges, cursors and pages with a 400', async () => {
    const { get } = world();
    for (const url of [
      '/v1/stats/daily?from=2026-11-06&to=2026-11-05',
      '/v1/stats/daily?from=2026-10-01&to=2026-11-06',
      '/v1/stats/chatters/daily?from=06/11/2026&to=2026-11-06',
      '/v1/stats/tracking-links/daily?from=2026-09-01&to=2026-11-06',
      '/v1/sales?since=abc',
      '/v1/sales?take=501',
    ]) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
    expect((await get('/v1/stats/daily?from=2026-10-07&to=2026-11-06')).statusCode).toBe(200);
  });

  it('answers 401 without a key, 403 without the access, 404 for a route it does not have', async () => {
    const { crm, get } = world();
    expect((await crm.app.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(401);
    crm.withhold('sales');
    expect((await get('/v1/sales')).statusCode).toBe(403);
    // The webhooks of sales need the Ventes access too.
    expect((await get('/v1/webhooks')).statusCode).toBe(403);
    expect((await get('/v1/models')).statusCode).toBe(200);
    expect((await get('/v1/conversations')).statusCode).toBe(404);
  });

  it('keeps a key limited to some models inside them: 403 outside, lists cut', async () => {
    const { crm, get } = world();
    crm.statsFromRegister();
    crm.sell({ id: 'sale_in', modelId: 'model_test_01', createdAt: '2026-11-05T10:00:00.000Z' });
    crm.sell({ id: 'sale_out', modelId: 'model_test_02', createdAt: '2026-11-05T10:00:00.000Z' });
    crm.limitTo(['model_test_01']);
    expect(
      (await get('/v1/stats/daily?from=2026-11-05&to=2026-11-05&modelId=model_test_02')).statusCode,
    ).toBe(403);
    expect(
      (
        await get(
          '/v1/stats/tracking-links/daily?from=2026-11-01&to=2026-11-05&trackingLinkId=link_test_autre',
        )
      ).statusCode,
    ).toBe(403);
    const sales = z
      .object({ data: z.array(z.object({ sale: z.object({ id: z.string() }) })) })
      .parse((await get('/v1/sales')).json());
    expect(sales.data.map((line) => line.sale.id)).toEqual(['sale_in']);
    const models = z
      .object({ data: z.array(z.object({ modelId: z.string() })) })
      .parse((await get('/v1/models')).json());
    expect(models.data.map((model) => model.modelId)).toEqual(['model_test_01']);
  });

  it('counts the statistics routes against 10 calls a minute per key, with Retry-After', async () => {
    const { get, advance } = world({ limits: true });
    for (let call = 0; call < 10; call += 1) {
      expect((await get('/v1/stats/daily?from=2026-11-05&to=2026-11-06')).statusCode).toBe(200);
    }
    const refused = await get('/v1/stats/chatters/daily?from=2026-11-05&to=2026-11-06');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // Another route has the general limit only.
    expect((await get('/v1/models')).statusCode).toBe(200);
    advance(61);
    expect((await get('/v1/stats/daily?from=2026-11-05&to=2026-11-06')).statusCode).toBe(200);
  });

  it('shares 20 statistics calls a minute between the agency’s keys', async () => {
    const { get } = world({ limits: true });
    for (let call = 0; call < 10; call += 1) {
      await get('/v1/stats/daily?from=2026-11-05&to=2026-11-06');
      await get('/v1/stats/daily?from=2026-11-05&to=2026-11-06', OTHER_KEY);
    }
    expect((await get('/v1/stats/daily?from=2026-11-05&to=2026-11-06', OTHER_KEY)).statusCode).toBe(429);
  });

  it('puts each sale in one column, the eight nets adding up to agency plus model, nobody’s sales on a null chatter', async () => {
    const { crm, get } = world();
    crm.statsFromRegister();
    const day = '2026-11-05T10:00:00.000Z';
    crm.sell({ id: 's1', type: 'ppv', createdAt: day, agencyRevenue: 300, modelRevenue: 500 });
    crm.sell({ id: 's2', type: 'tip', createdAt: day, agencyRevenue: 100, modelRevenue: 200 });
    crm.sell({
      id: 's3',
      type: 'subscription',
      chatterId: null,
      createdAt: day,
      agencyRevenue: 50,
      modelRevenue: 120,
    });
    crm.sell({
      id: 's4',
      type: 'mass_dm',
      chatterId: null,
      createdAt: day,
      agencyRevenue: 10,
      modelRevenue: 20,
    });
    const daily = z
      .object({ data: z.array(z.record(z.string(), z.unknown())) })
      .parse((await get('/v1/stats/daily?from=2026-11-05&to=2026-11-05')).json());
    const row = Object.fromEntries(
      Object.entries(daily.data[0] ?? {}).filter(
        (entry): entry is [string, number | null] => typeof entry[1] !== 'string',
      ),
    );
    const nets = Object.entries(row)
      .filter(([name]) => name.endsWith('NetRevenue'))
      .reduce((sum, [, value]) => sum + (value ?? 0), 0);
    expect(nets).toBe((row['agencyRevenue'] ?? 0) + (row['modelRevenue'] ?? 0));
    expect(row['ppvPurchased']).toBe(2);
    expect(row['tipsCount']).toBe(1);
    expect(row['newSubscribers']).toBe(1);
    // Counted the night after the key: null before.
    expect(row['messagesSent']).toBeNull();
    const chatters = z
      .object({
        data: z.array(
          z.object({
            chatterId: z.string().nullable(),
            netRevenue: z.number(),
            messagesSent: z.number().nullable(),
          }),
        ),
      })
      .parse((await get('/v1/stats/chatters/daily?from=2026-11-05&to=2026-11-05')).json());
    const nobody = chatters.data.find((line) => line.chatterId === null);
    expect(nobody?.netRevenue).toBe(200);
    expect(nobody?.messagesSent).toBeNull();
    crm.setNightlyDone(true);
    const after = z
      .object({ data: z.array(z.object({ messagesSent: z.number().nullable() })) })
      .parse((await get('/v1/stats/daily?from=2026-11-05&to=2026-11-05')).json());
    expect(after.data[0]?.messagesSent).toEqual(expect.any(Number));
  });

  it('leaves the days to come out', async () => {
    const { crm, get } = world();
    crm.statsFromRegister();
    crm.sell({ id: 'tomorrow', createdAt: '2026-11-07T10:00:00.000Z' });
    const daily = z
      .object({ data: z.array(z.unknown()) })
      .parse((await get('/v1/stats/daily?from=2026-11-06&to=2026-11-07')).json());
    expect(daily.data).toEqual([]);
  });

  it('gives a sale its status at the time of reading', async () => {
    const { crm, get } = world();
    crm.sell({ id: 'sold', createdAt: '2026-11-05T10:00:00.000Z' });
    crm.refund('sold', '2026-11-06T09:00:00.000Z');
    const page = z
      .object({
        data: z.array(
          z.object({
            event: z.string(),
            sale: z.object({ status: z.string(), refundedAt: z.string().nullable() }),
          }),
        ),
      })
      .parse((await get('/v1/sales')).json());
    expect(page.data.map((line) => [line.event, line.sale.status, line.sale.refundedAt])).toEqual([
      ['sale_created', 'refunded', '2026-11-06T09:00:00.000Z'],
      ['sale_refunded', 'refunded', '2026-11-06T09:00:00.000Z'],
    ]);
  });

  it('serves tracking links whose days add up to their totals, the clicks of before 11 September aside', async () => {
    const { get } = world();
    const list = z
      .object({
        data: z.array(
          z.object({
            trackingLinkId: z.string(),
            clicks: z.number(),
            newSubscribers: z.number(),
            freeSubscribers: z.number(),
            paidSubscribers: z.number(),
            url: z.string(),
          }),
        ),
      })
      .parse((await get('/v1/tracking-links?modelId=model_test_01')).json());
    expect(list.data.map((link) => link.trackingLinkId)).toEqual(['link_test_insta', 'link_test_tiktok']);
    const tiktok = list.data[1];
    expect(tiktok?.url).toBe('https://reveal.me/creatrice_test/Rc7Tktk');
    expect(tiktok && tiktok.freeSubscribers + tiktok.paidSubscribers).toBe(tiktok?.newSubscribers);
    // TikTok bio was made on 12 October: its days fit in two calls of 31 days at most.
    const days = await Promise.all(
      [['2026-10-12', '2026-11-06']].map(async ([from, to]) =>
        z
          .object({ data: z.array(z.object({ clicks: z.number() })) })
          .parse(
            (
              await get(
                `/v1/stats/tracking-links/daily?from=${from ?? ''}&to=${to ?? ''}&trackingLinkId=link_test_tiktok`,
              )
            ).json(),
          ),
      ),
    );
    const clicks = days.flatMap((page) => page.data).reduce((sum, day) => sum + day.clicks, 0);
    expect(clicks).toBe(tiktok?.clicks);
    const insta = list.data[0];
    expect(insta?.clicks).toBeGreaterThan(TRACKING_LINKS[0]?.clicksBefore ?? 0);
  });
});

describe('FakeReveal’s webhooks', () => {
  it('want HTTPS (this machine over HTTP in the sandbox only), 10 at most, and hide their secret after creation', async () => {
    const { send, get } = world();
    expect(
      (await send('POST', '/v1/webhooks', { url: 'http://127.0.0.1:3000/hook', events: ['sale_created'] }))
        .statusCode,
    ).toBe(400);
    const created = await send('POST', '/v1/webhooks', {
      url: 'https://crm.example.test/hook',
      events: ['sale_created'],
    });
    expect(created.statusCode).toBe(201);
    expect(WebhookSchema.parse(created.json()).secret).toMatch(/^whsec_/u);
    expect(JSON.stringify((await get('/v1/webhooks')).json())).not.toContain('whsec_');
    for (let more = 0; more < 9; more += 1) {
      await send('POST', '/v1/webhooks', {
        url: `https://crm.example.test/hook${String(more)}`,
        events: ['sale_created'],
      });
    }
    expect(
      (await send('POST', '/v1/webhooks', { url: 'https://crm.example.test/x', events: ['sale_created'] }))
        .statusCode,
    ).toBe(403);

    const sandbox = world({ allowLoopbackHttp: true });
    expect(
      (
        await sandbox.send('POST', '/v1/webhooks', {
          url: 'http://127.0.0.1:3000/hook',
          events: ['sale_created'],
        })
      ).statusCode,
    ).toBe(201);
  });

  it('are another key’s business: 404', async () => {
    const { send, get } = world();
    const { id } = WebhookSchema.parse(
      (
        await send('POST', '/v1/webhooks', { url: 'https://crm.example.test/hook', events: ['sale_created'] })
      ).json(),
    );
    expect((await get(`/v1/webhooks/${id}/deliveries`, OTHER_KEY)).statusCode).toBe(404);
    expect((await send('DELETE', `/v1/webhooks/${id}`, undefined, OTHER_KEY)).statusCode).toBe(404);
    expect((await send('PATCH', `/v1/webhooks/${id}`, { isActive: false })).statusCode).toBe(200);
  });

  it('deliver each sale signed, retry after 30 s, 1 min… and give up after 8 attempts; a retry is refused until then', async () => {
    const posted: { body: string; headers: Record<string, string> }[] = [];
    const deliver = vi.fn<DeliverWebhook>((_url, body, headers) => {
      posted.push({ body, headers });
      return Promise.resolve(500);
    });
    const { crm, send, get, advance } = world({ deliver });
    const { id, secret } = WebhookSchema.parse(
      (
        await send('POST', '/v1/webhooks', {
          url: 'https://crm.example.test/hook',
          events: ['sale_created', 'sale_refunded'],
        })
      ).json(),
    );
    crm.sell({ id: 'hooked', createdAt: '2026-11-06T12:00:00.000Z' });
    await crm.pumpDeliveries();
    expect(deliver).not.toHaveBeenCalled();
    advance(15);
    await crm.pumpDeliveries();
    expect(deliver).toHaveBeenCalledTimes(1);
    const first = posted[0];
    const t = /t=(\d+)/u.exec(first?.headers['x-reveal-signature'] ?? '')?.[1];
    expect(first?.headers['x-reveal-signature']).toBe(
      revealSignature(secret ?? '', Number(t), first?.body ?? ''),
    );
    expect(first?.headers['x-reveal-event']).toBe('sale_created');

    const listed = async () =>
      DeliveriesSchema.parse((await get(`/v1/webhooks/${id}/deliveries`)).json()).data[0];
    const delivery = await listed();
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.nextAttemptAt).toBe('2026-11-06T12:00:45.000Z');
    expect((await send('POST', `/v1/webhooks/${id}/deliveries/${delivery?.id ?? ''}/retry`)).statusCode).toBe(
      409,
    );

    for (const wait of [30, 60, 120, 240, 480, 960, 1920]) {
      advance(wait);
      await crm.pumpDeliveries();
    }
    expect(deliver).toHaveBeenCalledTimes(8);
    expect((await listed())?.status).toBe('failed');

    deliver.mockResolvedValue(204);
    expect((await send('POST', `/v1/webhooks/${id}/deliveries/${delivery?.id ?? ''}/retry`)).statusCode).toBe(
      202,
    );
    await crm.pumpDeliveries();
    expect((await listed())?.status).toBe('succeeded');
    expect((await send('POST', `/v1/webhooks/${id}/deliveries/unknown/retry`)).statusCode).toBe(404);
  });

  it('may send one twice, in any order, and lose those of an outage (caught up with /v1/sales)', async () => {
    const ids: string[] = [];
    const deliver = vi.fn<DeliverWebhook>((_url, body) => {
      ids.push(
        z.object({ data: z.object({ sale: z.object({ id: z.string() }) }) }).parse(JSON.parse(body)).data.sale
          .id,
      );
      return Promise.resolve(200);
    });
    const { crm, send, advance } = world({ deliver });
    await send('POST', '/v1/webhooks', { url: 'https://crm.example.test/hook', events: ['sale_created'] });
    crm.setShuffle(true);
    crm.duplicateNext(1);
    crm.sell({ id: 'a', createdAt: '2026-11-06T12:00:00.000Z' });
    crm.sell({ id: 'b', createdAt: '2026-11-06T12:00:00.000Z' });
    crm.setWebhookOutage(true);
    crm.sell({ id: 'lost', createdAt: '2026-11-06T12:00:00.000Z' });
    advance(20);
    await crm.pumpDeliveries();
    expect(ids).toEqual(['b', 'b', 'a']);
    expect(crm.deliveries.some((delivery) => delivery.cursor === crm.positionOf('lost'))).toBe(false);
  });
});
