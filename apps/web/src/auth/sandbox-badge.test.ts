// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSession } from './session';

function answer(headers: Record<string, string>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ state: 'signed_out' }), { headers }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['sandbox'];
});

describe('the sandbox badge (ADR 0075)', () => {
  it('is worn only when the API says it runs against the fake world', async () => {
    answer({});
    await readSession();
    expect(document.documentElement.dataset['sandbox']).toBeUndefined();
    answer({ 'x-impera-sandbox': '1' });
    await readSession();
    expect(document.documentElement.dataset['sandbox']).toBe('1');
  });
});
