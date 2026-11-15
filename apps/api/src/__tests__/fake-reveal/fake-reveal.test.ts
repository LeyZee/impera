import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ENDPOINTS, REVEAL_EXPECTED_CAPABILITIES } from './model';
import { createFakeReveal, type FakeReveal } from './server';

const opened: FakeReveal[] = [];

function fake(fixture: 'default' | 'empty' = 'default'): FakeReveal {
  const created = createFakeReveal({ fixture });
  opened.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((f) => f.app.close()));
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

async function call(
  f: FakeReveal,
  method: Method,
  url: string,
  body?: object,
): Promise<{ status: number; json: unknown; text: string; headers: Record<string, unknown>; raw: Buffer }> {
  const response = await f.app.inject({
    method,
    url,
    headers: { authorization: f.authorization },
    ...(body === undefined ? {} : { payload: body }),
  });
  const isJson = (response.headers['content-type'] ?? '').includes('json');
  return {
    status: response.statusCode,
    json: isJson ? response.json() : null,
    text: response.body,
    headers: response.headers,
    raw: response.rawPayload,
  };
}

async function scenario(f: FakeReveal, events: object[]): Promise<void> {
  const response = await f.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
  expect(response.statusCode).toBe(200);
}

async function advance(f: FakeReveal, ms: number): Promise<void> {
  await f.app.inject({ method: 'POST', url: '/__clock', payload: { advanceMs: ms } });
}

const shape = <S extends z.ZodType>(schema: S, json: unknown): z.infer<S> => schema.parse(json);

const list = async (
  f: FakeReveal,
  filter = 'all',
): Promise<z.infer<(typeof ENDPOINTS)['conversations.list']['shape']>> =>
  shape(
    ENDPOINTS['conversations.list'].shape,
    (await call(f, 'GET', `/conversations/model?take=20&modelId=${f.modelId}&filter=${filter}`)).json,
  );

const messages = async (
  f: FakeReveal,
  conversationId: string,
  query = 'take=10',
): Promise<z.infer<(typeof ENDPOINTS)['messages.list']['shape']>> =>
  shape(
    ENDPOINTS['messages.list'].shape,
    (await call(f, 'GET', `/conversations/${conversationId}/messages?${query}`)).json,
  );

const scriptsIn = async (
  f: FakeReveal,
  conversationId: string,
): Promise<z.infer<(typeof ENDPOINTS)['scripts.list']['shape']>['data']> =>
  shape(
    ENDPOINTS['scripts.list'].shape,
    (await call(f, 'GET', `/scripts/model/${f.modelId}?take=100&search=&conversationId=${conversationId}`))
      .json,
  ).data;

const send = async (
  f: FakeReveal,
  conversationId: string,
  body: object,
): Promise<z.infer<(typeof ENDPOINTS)['messages.send']['shape']>> =>
  shape(
    ENDPOINTS['messages.send'].shape,
    (await call(f, 'POST', `/conversations/${conversationId}/messages`, body)).json,
  );

describe('FakeReveal: session (L1)', () => {
  it('answers with the bearer token, 401 without it, and sends the rate-limit headers', async () => {
    const f = fake();
    const ok = await call(f, 'GET', `/models/${f.modelId}`);
    expect(shape(ENDPOINTS['models.get'].shape, ok.json).creatorNote).toBe('Note du modèle de test');
    expect(ok.headers['x-ratelimit-limit-long']).toBe('200');
    const anonymous = await f.app.inject({ method: 'GET', url: `/models/${f.modelId}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('expires the session when the scenario says so', async () => {
    const f = fake();
    await scenario(f, [{ type: 'session_expired', atMs: 60_000 }]);
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(200);
    await advance(f, 60_000);
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(401);
  });
});

describe('FakeReveal: inbox and history (L2, L3, L5, L11)', () => {
  it('lists conversations by last message, newest first, with the cursor of the last item', async () => {
    const f = fake();
    const first = shape(
      ENDPOINTS['conversations.list'].shape,
      (await call(f, 'GET', `/conversations/model?take=5&modelId=${f.modelId}&filter=all`)).json,
    );
    expect(first.data).toHaveLength(5);
    expect(first.pageInfo).toEqual({ hasNextPage: true, endCursor: first.data[4]?.conversation.id });
    const dates = first.data.map((item) => item.conversation.lastMessageAt ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);
    const next = shape(
      ENDPOINTS['conversations.list'].shape,
      (
        await call(
          f,
          'GET',
          `/conversations/model?take=5&modelId=${f.modelId}&filter=all&cursor=${first.pageInfo.endCursor ?? ''}`,
        )
      ).json,
    );
    expect(next.data[0]?.conversation.lastMessageAt ?? '').not.toBe('');
    expect((next.data[0]?.conversation.lastMessageAt ?? '') <= (dates[4] ?? '')).toBe(true);
  });

  it('gives, without opening the conversation, the unread flag, the preview, the spend and both notes', async () => {
    const f = fake();
    const item = (await list(f)).data.find((d) => d.conversation.id === 'conv_02');
    expect(item).toMatchObject({
      conversation: {
        modelIsUnread: false,
        memberFirstname: 'Prénom02',
      },
      memberTotalSpent: 2000,
      modelCreatorNote: 'Note du modèle de test',
      member: { userName: 'fan_test_02' },
    });
    expect(item?.conversation.note).toContain('Prénom02');
    expect(item?.lastMessage).not.toBeNull();
  });

  it('pages a 320-message history back to the first message, newest first', async () => {
    const f = fake();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await messages(f, 'conv_01', `take=100${cursor === null ? '' : `&cursor=${cursor}`}`);
      expect(page.totalCount).toBe(320);
      seen.push(...page.data.map((m) => m.message.content));
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor !== null);
    expect(seen).toHaveLength(320);
    expect(seen[0]).toBe('Message de test 320');
    expect(seen.at(-1)).toBe('Message de test 1');
  });

  it('shows a fan message from the scenario as unread at its time, with its sender, until read', async () => {
    const f = fake();
    await scenario(f, [
      { type: 'fan_message', atMs: 30_000, conversationId: 'conv_12', text: 'Coucou', mediaType: 'photo' },
    ]);
    expect((await messages(f, 'conv_12')).data).toEqual([]);
    await advance(f, 30_000);
    const top = (await list(f)).data[0];
    expect(top).toMatchObject({
      conversation: { id: 'conv_12', modelIsUnread: true },
      lastMessage: { content: 'Coucou' },
      lastMessageHasMedia: true,
      lastMessageAuthor: { member: { id: 'fan_12' } },
    });
    const received = (await messages(f, 'conv_12')).data[0];
    expect(received?.authorMessage).toEqual({ displayName: 'fan_test_12', memberId: 'fan_12' });
    expect(received?.medias[0]).toMatchObject({ type: 'photo', incomingMessageMemberId: 'fan_12' });
    const unread = shape(
      ENDPOINTS['conversations.count'].shape,
      (await call(f, 'GET', `/conversations/model/count?modelId=${f.modelId}&isUnread=true`)).json,
    );
    expect(unread.count).toBe(1);
    await call(f, 'PATCH', '/conversations/conv_12/read');
    expect((await list(f, 'unread')).data).toEqual([]);
  });

  it('answers 404 for a conversation that is gone', async () => {
    const f = fake();
    await scenario(f, [{ type: 'conversation_gone', conversationId: 'conv_02' }]);
    expect((await call(f, 'GET', '/conversations/conv_02/messages')).status).toBe(404);
  });
});

describe('FakeReveal: sending (E1, E2, E3, E7)', () => {
  it('sends a text as the team member, and a second identical send makes a second message (no nonce)', async () => {
    const f = fake();
    const body = { message: { content: 'Hello', isUnread: true }, mediaIds: [], files: [] };
    const a = await send(f, 'conv_02', body);
    const b = await send(f, 'conv_02', body);
    expect(b.id).not.toBe(a.id);
    const page = await messages(f, 'conv_02');
    expect(page.data[0]?.authorMessage).toEqual({ displayName: 'Chatteur bot' });
    expect(page.data.filter((m) => m.message.content === 'Hello')).toHaveLength(2);
  });

  it('refuses a bundle with no sold media or more than 10 previews', async () => {
    const f = fake();
    const bundle = (mediaIds: string[], teasingMediaIds: string[] = []): object => ({
      message: { content: 'Pour toi', isUnread: true },
      bundle: { type: 'media', price: 500, mediaIds, files: [], teasingMediaIds, teasingFiles: [] },
    });
    expect((await call(f, 'POST', '/conversations/conv_02/messages', bundle([]))).status).toBe(400);
    const teasers = Array.from({ length: 11 }, () => 'media_01');
    expect(
      (await call(f, 'POST', '/conversations/conv_02/messages', bundle(['media_02'], teasers))).status,
    ).toBe(400);
    const sent = await send(f, 'conv_02', bundle(['media_02']));
    expect(sent.bundleId).toBeDefined();
    const shown = (await messages(f, 'conv_02')).data[0]?.bundleWithMedias?.bundle;
    expect(shown).toMatchObject({ id: sent.bundleId, price: 500 });
    expect(shown?.isPaid).toBeUndefined();
  });

  it('sends a script step, and Reveal marks it as sent in that conversation only (L9)', async () => {
    const f = fake();
    const before = (await scriptsIn(f, 'conv_05')).find((s) => s.script.id === 'script_3_1');
    expect(before?.conversations).toEqual([]);
    const sent = await send(f, 'conv_05', {
      scriptId: 'script_3_1',
      message: { content: 'Coucou %NAME%, étape 1 du script 3', isUnread: true },
      bundle: {
        type: 'media',
        price: 500,
        mediaIds: ['media_07'],
        files: [],
        teasingMediaIds: [],
        teasingFiles: [],
      },
    });
    const after = (await scriptsIn(f, 'conv_05')).find((s) => s.script.id === 'script_3_1');
    expect(after?.conversations).toEqual([{ id: 'conv_05', hasBundle: true, isPaid: false }]);
    expect((await scriptsIn(f, 'conv_06')).find((s) => s.script.id === 'script_3_1')?.conversations).toEqual(
      [],
    );
    expect((await messages(f, 'conv_05')).data[0]?.message).toMatchObject({
      id: sent.id,
      content: 'Coucou Prénom05, étape 1 du script 3',
    });
  });

  it('keeps the fixture history: sequence 1 whole to fan 02 (2 bought), sequence 2 up to step 2 to fan 03', async () => {
    const f = fake();
    const sentIn = async (conversationId: string): Promise<string[]> =>
      (await scriptsIn(f, conversationId))
        .filter((s) => s.conversations.length > 0)
        .map((s) => `${s.script.id}:${String(s.conversations[0]?.isPaid)}`);
    expect(await sentIn('conv_02')).toEqual(['script_1_1:true', 'script_1_2:true', 'script_1_3:false']);
    expect(await sentIn('conv_03')).toEqual(['script_2_1:false', 'script_2_2:false']);
    const sequences = shape(
      ENDPOINTS['scriptSequences.list'].shape,
      (await call(f, 'GET', `/script-sequences/model/${f.modelId}`)).json,
    );
    expect(sequences[0]?.steps.map((s) => s.script.id)).toEqual(['script_1_1', 'script_1_2', 'script_1_3']);
  });

  it('uploads a voice note and sends it as a plain audio message (E7)', async () => {
    const f = fake();
    const link = await call(f, 'GET', '/medias/get-upload-url?name=vocal.mp3&type=audio&size=2048');
    expect(link.headers['content-type']).toContain('text/html');
    const target = new URL(link.text);
    const put = await f.app.inject({ method: 'PUT', url: target.pathname, payload: Buffer.from('ID3') });
    expect(put.statusCode).toBe(200);
    const key = target.pathname.replace('/upload/', '');
    await send(f, 'conv_02', {
      message: { content: '', isUnread: true },
      mediaIds: [],
      files: [{ type: 'audio', key }],
    });
    expect((await messages(f, 'conv_02')).data[0]?.medias[0]?.type).toBe('audio');
  });
});

describe('FakeReveal: purchases and the fan panel (L6, L7, L12, L13)', () => {
  it('unlocks a bundle on purchase with its transaction, and keeps spend, PPV tab and stats consistent', async () => {
    const f = fake();
    const sent = await send(f, 'conv_06', {
      message: { content: 'Surprise', isUnread: true },
      bundle: {
        type: 'media',
        price: 1500,
        mediaIds: ['media_03'],
        files: [],
        teasingMediaIds: [],
        teasingFiles: [],
      },
    });
    await scenario(f, [{ type: 'purchase', messageId: sent.id }]);
    const bundle = (await messages(f, 'conv_06')).data[0]?.bundleWithMedias?.bundle;
    expect(bundle?.isPaid).toBe(true);
    const tx = shape(
      ENDPOINTS['transactions.list'].shape,
      (await call(f, 'GET', `/transactions/model/${f.modelId}?take=10`)).json,
    );
    const sale = tx.data.find((t) => t.id === bundle?.transactionId);
    expect(sale).toMatchObject({ amount: 1500, memberId: 'fan_06', status: 'paid' });
    expect((await list(f)).data.find((d) => d.conversation.id === 'conv_06')?.memberTotalSpent).toBe(1500);
    const ppv = shape(
      ENDPOINTS['conversations.ppvHistory'].shape,
      (await call(f, 'GET', '/conversations/conv_06/ppv-history?take=10&kind=paid')).json,
    );
    expect(ppv).toMatchObject({ buyRate: { purchased: 1, total: 1, percentage: 100 }, highestPrice: 1500 });
    const stats = shape(
      ENDPOINTS['conversations.stats'].shape,
      (await call(f, 'GET', '/conversations/conv_06/stats')).json,
    );
    expect(stats).toMatchObject({ totalSpent: 1500, highestPurchase: 1500 });
    const notifications = shape(
      ENDPOINTS['notifications.list'].shape,
      (await call(f, 'GET', `/users/${f.userId}/notifications?take=5`)).json,
    );
    expect(notifications.data[0]).toMatchObject({ conversationId: 'conv_06' });
  });

  it('rounds the buy rate like Reveal (3 of 24 gives 13)', async () => {
    const f = fake('empty');
    const bundle = {
      type: 'media',
      price: 300,
      mediaIds: ['media_01'],
      files: [],
      teasingMediaIds: [],
      teasingFiles: [],
    };
    const ids: string[] = [];
    for (let i = 0; i < 24; i++)
      ids.push((await send(f, 'conv_01', { message: { content: '', isUnread: true }, bundle })).id);
    await scenario(
      f,
      ids.slice(0, 3).map((messageId) => ({ type: 'purchase', messageId })),
    );
    const ppv = shape(
      ENDPOINTS['conversations.ppvHistory'].shape,
      (await call(f, 'GET', '/conversations/conv_01/ppv-history?take=10&kind=paid')).json,
    );
    expect(ppv.buyRate).toEqual({ purchased: 3, total: 24, percentage: 13 });
  });

  it('replaces the client note whole, last write wins', async () => {
    const f = fake();
    const written = shape(
      ENDPOINTS['conversations.note'].shape,
      (await call(f, 'PATCH', '/conversations/conv_02/note', { note: 'Prénom : Nouveau' })).json,
    );
    expect(written.note).toBe('Prénom : Nouveau');
    expect((await list(f)).data.find((d) => d.conversation.id === 'conv_02')?.conversation.note).toBe(
      'Prénom : Nouveau',
    );
  });
});

describe('FakeReveal: vault and media files (L10, L14)', () => {
  it('lists folders and their media, and serves a real file behind a signed link that expires', async () => {
    const f = fake();
    const folders = shape(
      ENDPOINTS['vault.folders'].shape,
      (await call(f, 'GET', `/models/${f.modelId}/vault-folders`)).json,
    );
    expect(folders.map((d) => d.name)).toEqual(['SCRIPT 1 | ☀️', 'SCRIPT 2 | 🌙', 'Divers']);
    const vault = shape(
      ENDPOINTS['vault.medias'].shape,
      (await call(f, 'GET', `/models/${f.modelId}/medias?take=10&vaultFolderId=folder_3`)).json,
    );
    expect(vault.totalCount).toBe(5);
    const photo = vault.data.find((m) => m.type === 'photo');
    const file = await f.app.inject({
      method: 'GET',
      url: new URL(photo?.url ?? '').pathname + new URL(photo?.url ?? '').search,
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    await advance(f, 11 * 60_000);
    const expired = await f.app.inject({
      method: 'GET',
      url: new URL(photo?.url ?? '').pathname + new URL(photo?.url ?? '').search,
    });
    expect(expired.statusCode).toBe(403);
  });
});

describe('FakeReveal: faults (fake-reveal.md § Scénarios)', () => {
  it('limits sends to 60 a minute with their own headers, 429 beyond, until the window resets (headers.md)', async () => {
    const f = fake();
    const body = { message: { content: 'Coucou', isUnread: true }, mediaIds: [], files: [] };
    const first = await call(f, 'POST', '/conversations/conv_02/messages', body);
    expect(first.status).toBe(200);
    const resetAt = Number(first.headers['x-ratelimit-reset']);
    expect(first.headers['x-ratelimit-limit']).toBe('60');
    expect(first.headers['x-ratelimit-remaining']).toBe('59');
    expect(resetAt * 1_000).toBeGreaterThan(f.now().getTime());
    for (let i = 1; i < 60; i++) {
      expect((await call(f, 'POST', '/conversations/conv_03/messages', body)).status).toBe(200);
    }
    const over = await call(f, 'POST', '/conversations/conv_02/messages', body);
    expect(over.status).toBe(429);
    expect(over.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // Reads are not counted in the send window.
    expect(
      (await call(f, 'GET', '/conversations/conv_02/messages')).headers['x-ratelimit-limit'],
    ).toBeUndefined();
    await advance(f, 60_000);
    expect((await call(f, 'POST', '/conversations/conv_02/messages', body)).status).toBe(200);
  });

  it('takes a send and loses its answer: 504, yet the message is in the thread (« envoi accepté puis coupure »)', async () => {
    const f = fake();
    await scenario(f, [{ type: 'send_answer_lost', times: 1 }]);
    const body = { message: { content: 'Coupé', isUnread: true }, mediaIds: [], files: [] };
    expect((await call(f, 'POST', '/conversations/conv_02/messages', body)).status).toBe(504);
    expect((await messages(f, 'conv_02')).data[0]?.message.content).toBe('Coupé');
    expect((await call(f, 'POST', '/conversations/conv_02/messages', body)).status).toBe(200);
  });

  it('lists a sent message late when told (« message listé en retard »), a fan’s at once', async () => {
    const f = fake();
    await scenario(f, [{ type: 'send_listed_late', ms: 20_000 }]);
    const body = { message: { content: 'En retard', isUnread: true }, mediaIds: [], files: [] };
    expect((await call(f, 'POST', '/conversations/conv_02/messages', body)).status).toBe(200);
    await scenario(f, [{ type: 'fan_message', conversationId: 'conv_02', text: 'Tout de suite' }]);
    const contents = async () => (await messages(f, 'conv_02')).data.map((item) => item.message.content);
    expect(await contents()).toContain('Tout de suite');
    expect(await contents()).not.toContain('En retard');
    await advance(f, 20_000);
    expect(await contents()).toContain('En retard');
  });

  it('rate-limits n requests with Retry-After, then recovers', async () => {
    const f = fake();
    await scenario(f, [{ type: 'rate_limited', requests: 2, retryAfterSeconds: 30 }]);
    const first = await call(f, 'GET', `/models/${f.modelId}`);
    expect(first.status).toBe(429);
    expect(first.headers['retry-after']).toBe('30');
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(429);
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(200);
  });

  it('fails with a challenge page instead of JSON, then a server error', async () => {
    const f = fake();
    await scenario(f, [
      { type: 'server_error', times: 1, status: 503 },
      { type: 'challenge', times: 1 },
    ]);
    const challenge = await call(f, 'GET', `/models/${f.modelId}`);
    expect(challenge.status).toBe(403);
    expect(challenge.headers['content-type']).toContain('text/html');
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(503);
    expect((await call(f, 'GET', `/models/${f.modelId}`)).status).toBe(200);
  });

  it('renames a field to test that the connector rejects an unknown shape', async () => {
    const f = fake();
    await scenario(f, [
      { type: 'shape_changed', endpoint: 'models.get', rename: { from: 'creatorNote', to: 'note' } },
    ]);
    const json = (await call(f, 'GET', `/models/${f.modelId}`)).json;
    expect(ENDPOINTS['models.get'].shape.safeParse(json).success).toBe(false);
  });

  it('changes a step price between two reads', async () => {
    const f = fake();
    await scenario(f, [{ type: 'script_changed', scriptId: 'script_1_3', priceCents: 4500 }]);
    const step = (await scriptsIn(f, 'conv_02')).find((s) => s.script.id === 'script_1_3');
    expect(step?.script.price).toBe(4500);
  });

  it('resets to a fixture', async () => {
    const f = fake();
    await send(f, 'conv_02', { message: { content: 'x', isUnread: true } });
    await f.app.inject({ method: 'POST', url: '/__reset', payload: { fixture: 'empty' } });
    expect(f.state().messages).toEqual([]);
    expect(f.state().fans).toHaveLength(1);
  });
});

describe('FakeReveal over HTTP: list → conversation → send → read again', () => {
  it('plays the connector path with a plain fetch client (undici) on a real port', async () => {
    const f = fake();
    const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
    const get = async (path: string): Promise<unknown> => {
      const response = await fetch(`${base}${path}`, { headers: { authorization: f.authorization } });
      expect(response.status).toBe(200);
      return response.json();
    };
    const inbox = shape(
      ENDPOINTS['conversations.list'].shape,
      await get(`/conversations/model?take=20&modelId=${f.modelId}`),
    );
    const target = inbox.data.find((d) => d.member.userName === 'fan_test_02')?.conversation.id ?? '';
    const before = shape(
      ENDPOINTS['messages.list'].shape,
      await get(`/conversations/${target}/messages?take=10`),
    );
    const response = await fetch(`${base}/conversations/${target}/messages`, {
      method: 'POST',
      headers: { authorization: f.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { content: 'Réponse du bot', isUnread: true },
        mediaIds: [],
        files: [],
      }),
    });
    expect(response.status).toBe(200);
    const sent = shape(ENDPOINTS['messages.send'].shape, await response.json());
    const after = shape(
      ENDPOINTS['messages.list'].shape,
      await get(`/conversations/${target}/messages?take=10`),
    );
    expect(after.totalCount).toBe(before.totalCount + 1);
    expect(after.data[0]?.message).toMatchObject({ id: sent.id, content: 'Réponse du bot' });
  });
});

it('declares the capabilities a Reveal connector can claim', () => {
  expect(REVEAL_EXPECTED_CAPABILITIES).toEqual({
    unreadWithoutOpen: true,
    sendMedia: true,
    transactions: true,
    markRead: true,
    typing: true,
    realtime: false,
    fanProfile: true,
    fanNoteRead: true,
    fanNoteWrite: true,
    creatorNotes: true,
    ppvStats: true,
    scripts: true,
    scriptHistory: true,
    vault: true,
  });
});
