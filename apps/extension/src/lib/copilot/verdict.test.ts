import { CopilotVerdictBodySchema } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../session';

import { sendVerdict } from './verdict';

const ORIGIN = 'http://localhost:5173';
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
/* A made-up link of the right shape, never a real one. */
const LINK = 'a'.repeat(43);
const PLACED = CopilotVerdictBodySchema.parse({ kind: 'placed', creatorId: id(1), edited: false });

function answer(status: number, body: unknown): Fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('the chatter’s gesture on a draft (ADR 0086 § 4, § 8)', () => {
  it('goes with the person’s link, never the CRM’s cookie', async () => {
    const fetchFn = answer(200, { draftId: id(9), outcome: 'placed', replayed: false });
    expect(await sendVerdict(ORIGIN, LINK, id(9), PLACED, fetchFn)).toBe('sent');
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/copilot/drafts/${id(9)}/verdict`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('x-extension-link')).toBe(LINK);
    expect(typeof init?.body === 'string' ? JSON.parse(init.body) : null).toEqual(PLACED);
  });

  it('says a missing or removed link, a draft gone, and a CRM that does not answer', async () => {
    const never: Fetch = vi.fn();
    expect(await sendVerdict(ORIGIN, null, id(9), PLACED, never)).toBe('unlinked');
    expect(never).not.toHaveBeenCalled();
    expect(await sendVerdict(ORIGIN, LINK, id(9), PLACED, answer(401, null))).toBe('unlinked');
    expect(await sendVerdict(ORIGIN, LINK, id(9), PLACED, answer(409, null))).toBe('refused');
    expect(await sendVerdict(ORIGIN, LINK, id(9), PLACED, answer(503, null))).toBe('unreachable');
    const down: Fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sendVerdict(ORIGIN, LINK, id(9), PLACED, down)).toBe('unreachable');
  });
});
