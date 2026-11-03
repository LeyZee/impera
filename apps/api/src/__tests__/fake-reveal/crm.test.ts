import { afterEach, describe, expect, it } from 'vitest';

import { revealSalesFeed } from '../../modules/connectors';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, revealSignature, type FakeCrm } from './crm';

const opened: FakeCrm[] = [];

const revealSalesFeedFactory = () => revealSalesFeed(fetch, FAKE_CRM_BASE_URL);

function setup(key = FAKE_CRM_KEY) {
  const crm = createFakeCrm();
  opened.push(crm);
  return { crm, feed: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL).create(key) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((crm) => crm.app.close()));
});

/** Reveal's CRM adapter against FakeReveal's CRM API (ADR 0050 § 9). */
describe('Reveal sales feed adapter', () => {
  it('reads the register by cursor in its own order, a late sale after newer ones, with its amounts in cents', async () => {
    const { crm, feed } = setup();
    crm.sell({ id: 'sale_a', createdAt: '2026-10-20T18:00:00.000Z' });
    crm.sell({
      id: 'sale_b',
      createdAt: '2026-10-20T18:05:00.000Z',
      type: 'tip',
      chatterId: null,
      fan: null,
    });

    const first = await feed.readSales(null);
    if (!first.ok) throw new Error('read failed');
    expect(first.value.sales.map((sale) => sale.platformSaleId)).toEqual(['sale_a', 'sale_b']);
    expect(first.value.sales[0]).toMatchObject({
      event: 'sale',
      type: 'ppv',
      status: 'paid',
      platformModelId: 'model_test_01',
      platformChatterId: 'chatter_test_01',
      platformFanId: 'member_test_01',
      currency: 'EUR',
      amounts: { grossInclVat: 1200, grossExclVat: 1000, net: 800, agency: 300, creator: 500 },
    });
    expect(first.value.sales[1]).toMatchObject({ type: 'tip', platformChatterId: null, platformFanId: null });
    expect(first.value.hasMore).toBe(false);

    // Confirmed late (3-D Secure): dated before the others, registered after them; the cursor still reaches it.
    crm.sell({ id: 'sale_late', createdAt: '2026-10-20T17:00:00.000Z' });
    const next = await feed.readSales(first.value.endPosition);
    if (!next.ok) throw new Error('read failed');
    expect(next.value.sales.map((sale) => sale.platformSaleId)).toEqual(['sale_late']);
    expect(next.value.sales[0]?.occurredAt).toBe('2026-10-20T17:00:00.000Z');

    const empty = await feed.readSales(next.value.endPosition);
    expect(empty.ok && empty.value).toMatchObject({ sales: [], endPosition: next.value.endPosition });
  });

  it('never carries the fan pseudo past the adapter', async () => {
    const { crm, feed } = setup();
    crm.sell({ id: 'sale_a' });
    const read = await feed.readSales(null);
    expect(JSON.stringify(read)).not.toContain('fan_test_01');
  });

  it('reads a refund as its own line carrying the sale amounts', async () => {
    const { crm, feed } = setup();
    crm.sell({ id: 'sale_a' });
    crm.refund('sale_a', '2026-10-22T09:00:00.000Z');
    const read = await feed.readSales(null);
    if (!read.ok) throw new Error('read failed');
    expect(read.value.sales.map((sale) => [sale.platformSaleId, sale.event, sale.status])).toEqual([
      ['sale_a', 'sale', 'paid'],
      ['sale_a', 'refund', 'refunded'],
    ]);
    expect(read.value.sales[1]?.amounts.net).toBe(800);
    expect(read.value.sales[1]?.occurredAt).toBe('2026-10-22T09:00:00.000Z');
  });

  it('reads an unknown type or status as other and keeps it; skips an unknown event; all three reported', async () => {
    const { crm, feed } = setup();
    crm.sell({ id: 'sale_a', type: 'live_ticket', status: 'disputed' });
    crm.appendRaw('sale_disputed', rawSale('sale_b'), '2026-10-20T18:00:00.000Z');
    const read = await feed.readSales(null);
    if (!read.ok) throw new Error('read failed');
    expect(read.value.sales).toHaveLength(1);
    expect(read.value.sales[0]).toMatchObject({
      type: 'other',
      rawType: 'live_ticket',
      status: 'other',
      rawStatus: 'disputed',
    });
    expect(read.value.unknown).toEqual([
      { field: 'type', value: 'live_ticket' },
      { field: 'status', value: 'disputed' },
      { field: 'event', value: 'sale_disputed' },
    ]);
    // The skipped line still moves the cursor: it is never read again.
    expect(read.value.endPosition).toBe('1002');
  });

  it('refuses a page whose net is not agency + model, and one whose shape changed, without a value in the detail', async () => {
    const { crm, feed } = setup();
    crm.sell({ id: 'sale_a', netAmount: 801 });
    const broken = await feed.readSales(null);
    expect(broken).toEqual({
      ok: false,
      failure: { kind: 'unexpected_answer', detail: '/v1/sales: netAmount ≠ agency + model' },
    });

    const swapped = setup();
    swapped.crm.sell({ id: 'sale_a', amountTtc: 1000, amountHt: 1200 });
    expect(await swapped.feed.readSales(null)).toEqual({
      ok: false,
      failure: { kind: 'unexpected_answer', detail: '/v1/sales: net ≤ amountHt ≤ amountTtc broken' },
    });

    const second = setup();
    second.crm.sell({ id: 'sale_a' });
    second.crm.breakShape(1);
    const reshaped = await second.feed.readSales(null);
    expect(reshaped).toEqual({
      ok: false,
      failure: { kind: 'unexpected_answer', detail: '/v1/sales: pageInfo' },
    });
  });

  it('honours Retry-After on a 429, stops on a 401 or a 403', async () => {
    const limited = setup();
    limited.crm.rateLimit(1, 42);
    expect(await limited.feed.readSales(null)).toEqual({
      ok: false,
      failure: { kind: 'rate_limited', retryAfterMs: 42_000 },
    });

    const revoked = setup();
    revoked.crm.revoke();
    expect(await revoked.feed.readSales(null)).toEqual({
      ok: false,
      failure: { kind: 'refused', errorKind: 'unauthorized' },
    });

    const withheld = setup();
    withheld.crm.withhold('sales');
    expect(await withheld.feed.readSales(null)).toEqual({
      ok: false,
      failure: { kind: 'refused', errorKind: 'missing_access' },
    });
  });

  it('verifies a key on both accesses before it is trusted', async () => {
    expect(await setup().feed.verify()).toEqual({ ok: true, value: ['sales', 'stats', 'team'] });
    expect(await setup('rvl_fake_key_revoked').feed.verify()).toEqual({
      ok: false,
      failure: { kind: 'refused', errorKind: 'unauthorized' },
    });
    const statsOnly = setup();
    statsOnly.crm.withhold('sales');
    expect(await statsOnly.feed.verify()).toEqual({
      ok: false,
      failure: { kind: 'refused', errorKind: 'missing_access' },
    });
    expect(statsOnly.crm.calls.map((call) => `${call.path} ${String(call.status)}`)).toEqual([
      '/v1/models 200',
      '/v1/sales 403',
    ]);
  });

  it('registers a webhook, gets its secret once, removes it; a webhook Reveal no longer knows counts as removed', async () => {
    const { crm, feed } = setup();
    const created = await feed.createWebhook('https://impera.example.test/v1/webhooks/sales-feeds/reveal');
    if (!created.ok) throw new Error('webhook refused');
    expect(crm.webhooks.get(created.value.platformWebhookId)?.secret).toBe(created.value.secret);
    expect(await feed.deleteWebhook(created.value.platformWebhookId)).toEqual({ ok: true, value: null });
    expect(crm.webhooks.size).toBe(0);
    expect(await feed.deleteWebhook(created.value.platformWebhookId)).toEqual({ ok: true, value: null });

    crm.withhold('webhooks');
    const refused = await feed.createWebhook('https://impera.example.test/v1/webhooks/sales-feeds/reveal');
    expect(refused).toMatchObject({ ok: false, failure: { kind: 'refused', errorKind: 'missing_access' } });
  });

  it('reads a delivery only when signed with the secret, within five minutes, over its raw bytes', async () => {
    const { crm, feed } = setup();
    const created = await feed.createWebhook('https://impera.example.test/v1/webhooks/sales-feeds/reveal');
    if (!created.ok) throw new Error('webhook refused');
    const { secret } = created.value;
    const position = crm.sell({ id: 'sale_a' });
    const now = new Date();
    const read = (body: string, headers: Record<string, string>, at = now) =>
      revealSalesFeedFactory().readDelivery({ rawBody: Buffer.from(body), headers, secret, now: at });

    const signed = crm.delivery(position);
    expect(read(signed.body, signed.headers)).toEqual({
      ok: true,
      deliveryId: `delivery_${position}`,
      event: 'sale_created',
      position,
    });
    expect(read(signed.body, signed.headers, new Date(now.getTime() + 6 * 60_000))).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(read(`${signed.body} `, signed.headers)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(read(signed.body, {})).toEqual({ ok: false, reason: 'unsigned' });
    expect(read(signed.body, { 'x-reveal-signature': 'v1=abc' })).toEqual({ ok: false, reason: 'unsigned' });
    const forged = crm.delivery(position, { secret: 'whsec_other' });
    expect(read(forged.body, forged.headers)).toEqual({ ok: false, reason: 'bad_signature' });
    // Signed, but not a delivery: nothing of it is read.
    const t = Math.floor(now.getTime() / 1000);
    const odd = '{"hello":"world"}';
    expect(read(odd, { 'x-reveal-signature': revealSignature(secret, t, odd) })).toEqual({
      ok: false,
      reason: 'malformed',
    });
    // A second signature, as during a rotation of Reveal's secret, is accepted when one of them holds.
    const both = `${revealSignature('whsec_old', t, signed.body)},v1=${revealSignature(secret, t, signed.body).split('v1=')[1] ?? ''}`;
    expect(read(signed.body, { 'x-reveal-signature': both })).toMatchObject({ ok: true });
  });

  it('lists models, team and statistics in the contract shape', async () => {
    const { feed } = setup();
    const models = await feed.listModels();
    expect(models.ok && models.value[0]).toEqual({
      platformModelId: 'model_test_01',
      handle: 'creatrice_test',
      displayName: 'Créatrice test',
      isActive: true,
    });
    const chatters = await feed.listChatters();
    expect(
      chatters.ok && chatters.value.map((chatter) => [chatter.platformChatterId, chatter.isBot]),
    ).toEqual([
      ['chatter_test_01', false],
      ['bot_test_01', true],
    ]);
    const daily = await feed.dailyStats({ from: '2026-10-20', to: '2026-10-20' });
    expect(daily.ok && daily.value[0]).toMatchObject({
      date: '2026-10-20',
      revenueInclVat: 1200,
      agency: 300,
      creator: 500,
      messagesSent: null,
    });
    const perChatter = await feed.chatterDailyStats({ from: '2026-10-20', to: '2026-10-20' });
    expect(perChatter.ok && perChatter.value.map((row) => row.platformChatterId)).toEqual([
      'chatter_test_01',
      null,
    ]);
  });
});

function rawSale(id: string) {
  return {
    id,
    modelId: 'model_test_01',
    type: 'ppv',
    status: 'paid',
    createdAt: '2026-10-20T18:00:00.000Z',
    amountTtc: 1200,
    amountHt: 1000,
    agencyRevenue: 300,
    modelRevenue: 500,
    fan: null,
    chatterId: null,
  };
}
