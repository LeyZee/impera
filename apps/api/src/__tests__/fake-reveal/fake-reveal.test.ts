import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ENDPOINTS } from './model';
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

async function call(
  f: FakeReveal,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: object,
): Promise<{ status: number; json: unknown; headers: Record<string, unknown>; raw: Buffer }> {
  const response = await f.app.inject({
    method,
    url,
    headers: { cookie: f.sessionCookie },
    ...(body === undefined ? {} : { payload: body }),
  });
  const isJson = (response.headers['content-type'] ?? '').includes('json');
  return {
    status: response.statusCode,
    json: isJson ? response.json() : null,
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

describe('FakeReveal: session (L1)', () => {
  it('answers with the team member when the session cookie is right, 401 otherwise', async () => {
    const f = fake();
    expect(shape(ENDPOINTS['session.me'].shape, (await call(f, 'GET', '/api/me')).json).teamMember).toBe(
      'Chatteur bot',
    );
    const anonymous = await f.app.inject({ method: 'GET', url: '/api/me' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('expires the session when the scenario says so', async () => {
    const f = fake();
    await scenario(f, [{ type: 'session_expired', atMs: 60_000 }]);
    expect((await call(f, 'GET', '/api/me')).status).toBe(200);
    await advance(f, 60_000);
    expect((await call(f, 'GET', '/api/me')).status).toBe(401);
  });
});

describe('FakeReveal: inbox and history (L2, L3)', () => {
  it('lists conversations most recent first, paginated, with unread filter', async () => {
    const f = fake();
    const first = shape(
      ENDPOINTS['conversations.list'].shape,
      (await call(f, 'GET', '/api/conversations?limit=5')).json,
    );
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toBe('5');
    const dates = first.items.map((c) => c.lastMessageAt ?? '');
    expect([...dates].sort().reverse()).toEqual(dates);
    const unread = shape(
      ENDPOINTS['conversations.list'].shape,
      (await call(f, 'GET', '/api/conversations?unread=1')).json,
    );
    expect(unread.items).toEqual([]);
  });

  it('pages a 320-message history back to the first message', async () => {
    const f = fake();
    const seen: string[] = [];
    const pageBefore = async (before: string | null): Promise<string | null> => {
      const url = `/api/conversations/conv_01/messages?limit=100${before === null ? '' : `&before=${before}`}`;
      const page = shape(ENDPOINTS['messages.list'].shape, (await call(f, 'GET', url)).json);
      seen.unshift(...page.items.map((m) => m.text));
      return page.nextBefore;
    };
    let before = await pageBefore(null);
    while (before !== null) before = await pageBefore(before);
    expect(seen).toHaveLength(320);
    expect(seen[0]).toBe('Message de test 1');
  });

  it('shows a fan message from the scenario as unread, at its time', async () => {
    const f = fake();
    await scenario(f, [{ type: 'fan_message', atMs: 30_000, conversationId: 'conv_12', text: 'Coucou' }]);
    expect((await call(f, 'GET', '/api/conversations/conv_12/messages')).json).toMatchObject({ items: [] });
    await advance(f, 30_000);
    const list = shape(
      ENDPOINTS['conversations.list'].shape,
      (await call(f, 'GET', '/api/conversations?limit=1')).json,
    );
    expect(list.items[0]).toMatchObject({ id: 'conv_12', unreadCount: 1, lastMessagePreview: 'Coucou' });
    await call(f, 'POST', '/api/conversations/conv_12/read');
    const after = shape(
      ENDPOINTS['conversations.list'].shape,
      (await call(f, 'GET', '/api/conversations?unread=1')).json,
    );
    expect(after.items).toEqual([]);
  });

  it('answers 404 for a conversation that is gone', async () => {
    const f = fake();
    await scenario(f, [{ type: 'conversation_gone', conversationId: 'conv_02' }]);
    expect((await call(f, 'GET', '/api/conversations/conv_02/messages')).status).toBe(404);
  });
});

describe('FakeReveal: sending (E1, E2, E3)', () => {
  it('sends a text once per nonce, signed by the team member', async () => {
    const f = fake();
    const body = { text: 'Hello', nonce: 'n-1' };
    const a = shape(
      ENDPOINTS['messages.send'].shape,
      (await call(f, 'POST', '/api/conversations/conv_02/messages', body)).json,
    );
    const b = shape(
      ENDPOINTS['messages.send'].shape,
      (await call(f, 'POST', '/api/conversations/conv_02/messages', body)).json,
    );
    expect(b.message.id).toBe(a.message.id);
    expect(a.message.author).toBe('Chatteur bot');
    expect(f.state().messages.filter((m) => m.nonce === 'n-1')).toHaveLength(1);
  });

  it('refuses a bundle with no sold media or more than 10 previews', async () => {
    const f = fake();
    const base = { text: 'Pour toi', priceCents: 500, nonce: 'b-1' };
    expect(
      (await call(f, 'POST', '/api/conversations/conv_02/bundles', { ...base, mediaIds: [] })).status,
    ).toBe(400);
    const teasers = Array.from({ length: 11 }, () => 'media_01');
    const tooMany = { ...base, mediaIds: ['media_02'], teaserMediaIds: teasers };
    expect((await call(f, 'POST', '/api/conversations/conv_02/bundles', tooMany)).status).toBe(400);
    const ok = await call(f, 'POST', '/api/conversations/conv_02/bundles', {
      ...base,
      mediaIds: ['media_02'],
    });
    expect(shape(ENDPOINTS['bundles.send'].shape, ok.json).message).toMatchObject({
      kind: 'bundle',
      unlocked: false,
    });
  });

  it('sends a script step with the first name, and Reveal marks it as used for that fan', async () => {
    const f = fake();
    const step = { scriptId: 'script_3', stepIndex: 0, nonce: 's-1' };
    const sent = shape(
      ENDPOINTS['scripts.sendStep'].shape,
      (await call(f, 'POST', '/api/conversations/conv_05/script-steps', step)).json,
    );
    expect(sent.message.text).toBe('Coucou Prénom05, étape 1 du script 3');
    const history = shape(
      ENDPOINTS['fans.scriptHistory'].shape,
      (await call(f, 'GET', '/api/fans/fan_05/script-history')).json,
    );
    expect(history.items).toEqual([{ scriptId: 'script_3', stepIndex: 0, sentAt: sent.message.createdAt }]);
  });

  it('keeps the fixture history: script 1 whole to fan 02, script 2 up to step 2 to fan 03', async () => {
    const f = fake();
    const of = async (fanId: string): Promise<string[]> =>
      shape(
        ENDPOINTS['fans.scriptHistory'].shape,
        (await call(f, 'GET', `/api/fans/${fanId}/script-history`)).json,
      ).items.map((u) => `${u.scriptId}#${String(u.stepIndex)}`);
    expect(await of('fan_02')).toEqual(['script_1#0', 'script_1#1', 'script_1#2']);
    expect(await of('fan_03')).toEqual(['script_2#0', 'script_2#1']);
  });
});

describe('FakeReveal: purchases and fan panel (L5, L6, L7, L11, L13)', () => {
  it('unlocks a bundle on purchase and keeps profile, transactions and PPV stats consistent', async () => {
    const f = fake();
    const sent = shape(
      ENDPOINTS['bundles.send'].shape,
      (
        await call(f, 'POST', '/api/conversations/conv_06/bundles', {
          text: 'Surprise',
          mediaIds: ['media_03'],
          priceCents: 1500,
          nonce: 'p-1',
        })
      ).json,
    );
    await scenario(f, [{ type: 'purchase', messageId: sent.message.id }]);
    expect(
      shape(ENDPOINTS['fans.get'].shape, (await call(f, 'GET', '/api/fans/fan_06')).json).totalSpentCents,
    ).toBe(1500);
    const stats = shape(
      ENDPOINTS['fans.ppvStats'].shape,
      (await call(f, 'GET', '/api/fans/fan_06/ppv-stats')).json,
    );
    expect(stats).toMatchObject({ sentCount: 1, boughtCount: 1, minPriceCents: 1500, maxPriceCents: 1500 });
    const tx = shape(ENDPOINTS['transactions.list'].shape, (await call(f, 'GET', '/api/transactions')).json);
    expect(tx.items.filter((t) => t.messageId === sent.message.id)).toHaveLength(1);
  });

  it('reads and writes the client note, reads the model note', async () => {
    const f = fake();
    const before = shape(
      ENDPOINTS['fans.note.get'].shape,
      (await call(f, 'GET', '/api/fans/fan_02/note')).json,
    );
    expect(before.text).toContain('Prénom : Prénom02');
    await call(f, 'PUT', '/api/fans/fan_02/note', { text: 'Prénom : Nouveau' });
    expect(
      shape(ENDPOINTS['fans.note.get'].shape, (await call(f, 'GET', '/api/fans/fan_02/note')).json).text,
    ).toBe('Prénom : Nouveau');
    expect(
      shape(ENDPOINTS['creatorNote.get'].shape, (await call(f, 'GET', '/api/creator-note')).json).text,
    ).toBe('Note du modèle de test');
  });
});

describe('FakeReveal: media files (L10, L14)', () => {
  it('serves a real file behind a signed link that expires', async () => {
    const f = fake();
    const vault = shape(
      ENDPOINTS['vault.list'].shape,
      (await call(f, 'GET', '/api/vault?folder=Divers')).json,
    );
    expect(vault.items).toHaveLength(5);
    const link = shape(
      ENDPOINTS['media.link'].shape,
      (await call(f, 'GET', '/api/media/media_01/link')).json,
    );
    const file = await call(f, 'GET', link.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.raw.subarray(1, 4).toString()).toBe('PNG');
    await advance(f, 11 * 60_000);
    expect((await call(f, 'GET', link.url)).status).toBe(403);
  });
});

describe('FakeReveal: faults (fake-reveal.md § Scénarios)', () => {
  it('rate-limits n requests with Retry-After, then recovers', async () => {
    const f = fake();
    await scenario(f, [{ type: 'rate_limited', requests: 2, retryAfterSeconds: 30 }]);
    const first = await call(f, 'GET', '/api/me');
    expect(first.status).toBe(429);
    expect(first.headers['retry-after']).toBe('30');
    expect((await call(f, 'GET', '/api/me')).status).toBe(429);
    expect((await call(f, 'GET', '/api/me')).status).toBe(200);
  });

  it('fails with a server error, then a challenge page instead of JSON', async () => {
    const f = fake();
    await scenario(f, [
      { type: 'server_error', times: 1, status: 503 },
      { type: 'challenge', times: 1 },
    ]);
    const challenge = await call(f, 'GET', '/api/me');
    expect(challenge.status).toBe(403);
    expect(challenge.headers['content-type']).toContain('text/html');
    expect((await call(f, 'GET', '/api/me')).status).toBe(503);
    expect((await call(f, 'GET', '/api/me')).status).toBe(200);
  });

  it('renames a field to test that the connector rejects an unknown shape', async () => {
    const f = fake();
    await scenario(f, [
      { type: 'shape_changed', endpoint: 'session.me', rename: { from: 'teamMember', to: 'member' } },
    ]);
    const json = (await call(f, 'GET', '/api/me')).json;
    expect(ENDPOINTS['session.me'].shape.safeParse(json).success).toBe(false);
  });

  it('changes a script price between two reads', async () => {
    const f = fake();
    await scenario(f, [{ type: 'script_changed', scriptId: 'script_1', stepIndex: 2, priceCents: 4500 }]);
    const scripts = shape(ENDPOINTS['scripts.list'].shape, (await call(f, 'GET', '/api/scripts')).json);
    expect(scripts.items[0]?.steps[2]?.priceCents).toBe(4500);
  });

  it('resets to a fixture', async () => {
    const f = fake();
    await call(f, 'POST', '/api/conversations/conv_02/messages', { text: 'x', nonce: 'r-1' });
    await f.app.inject({ method: 'POST', url: '/__reset', payload: { fixture: 'empty' } });
    expect(f.state().messages).toEqual([]);
    expect(f.state().fans).toHaveLength(1);
  });
});
