import { describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../session';

import { readDraftView, readFanCard, readStanding } from './api';

const ORIGIN = 'http://localhost:5173';
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const CONVERSATION = {
  creatorId: id(1),
  conversationId: id(2),
  fanId: id(3),
  switches: { fanCard: true, drafts: false },
};

function answer(status: number, body: unknown): Fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const error = (code: string): unknown => ({ error: { code, message: 'x', details: {}, requestId: 'r' } });

describe('what the panel reads with the CRM’s session (ADR 0086 § 8)', () => {
  it('reads the open conversation with the browser’s cookie, never a link', async () => {
    const fetchFn = answer(200, { state: 'none', conversation: CONVERSATION });
    expect(await readDraftView(ORIGIN, 'c-41ab9', null, fetchFn)).toEqual({
      kind: 'view',
      view: { state: 'none', conversation: CONVERSATION },
    });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/copilot/conversations/c-41ab9/draft?platform=reveal`);
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).has('x-extension-link')).toBe(false);
  });

  it('tells a shift refusal from another refusal, a conflict, a lost session and a CRM down', async () => {
    const read = (status: number, body: unknown): Promise<unknown> =>
      readDraftView(ORIGIN, 'c-1', null, answer(status, body)).then((one) => one.kind);
    expect(await read(403, error('copilot_shift_forbidden'))).toBe('off_shift');
    expect(await read(403, error('creator_forbidden'))).toBe('forbidden');
    expect(await read(409, error('copilot_creator_conflict'))).toBe('conflict');
    expect(await read(401, error('unauthenticated'))).toBe('signed_out');
    expect(await read(502, null)).toBe('down');
    // An answer that is not the contract's is not shown.
    expect(await read(200, { state: 'ready', conversation: CONVERSATION })).toBe('down');
    const unreachable: Fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await readDraftView(ORIGIN, 'c-1', null, unreachable)).kind).toBe('down');
  });

  it('reads the fan’s card by his creator and his id', async () => {
    const card = { fanId: id(3), fields: [], others: [] };
    const fetchFn = answer(200, card);
    expect(await readFanCard(ORIGIN, id(1), id(3), fetchFn)).toEqual({ kind: 'card', card });
    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/fans/${id(3)}/card?creatorId=${id(1)}`);
    expect((await readFanCard(ORIGIN, id(1), id(3), answer(403, error('x')))).kind).toBe('forbidden');
  });

  it('reads where things stand: his limits and his desire, and says limits it could not read', async () => {
    const detail = {
      id: id(2),
      fanId: id(3),
      fanDisplayName: 'marc_lyon',
      state: 'idle',
      mode: 'copilot',
      lastInboundAt: null,
      lastOutboundAt: null,
      unreadCount: 0,
      updatedAt: '2026-11-08T18:00:00.000Z',
      desire: { score: 55, band: 'playful' },
      heldBy: null,
      careSince: null,
      openDrafts: [],
      failedDraft: null,
    };
    const both: Fetch = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/flags')
              ? { fanId: id(3), flags: { fragile: true }, mayConfirmDisputedAge: false }
              : detail,
          ),
          { status: 200 },
        ),
      ),
    );
    expect(await readStanding(ORIGIN, id(1), id(2), id(3), both)).toEqual({
      flags: { fragile: true },
      band: 'playful',
    });
    expect(
      vi
        .mocked(both)
        .mock.calls.map((call) => call[0])
        .sort(),
    ).toEqual([
      `${ORIGIN}/v1/conversations/${id(2)}?creatorId=${id(1)}`,
      `${ORIGIN}/v1/fans/${id(3)}/flags?creatorId=${id(1)}`,
    ]);
    expect(await readStanding(ORIGIN, id(1), id(2), id(3), answer(502, null))).toEqual({
      flags: 'unread',
      band: null,
    });
  });
});
