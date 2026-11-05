// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PhoneDialog } from './PhoneDialog';

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** Her live link since 1 November, without the shifts of her accounts until she chooses them. Invented (ADR 0010). */
function serve(link: { createdAt: string; withShifts: boolean } | null): Call[] {
  const calls: Call[] = [];
  let current = link;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      if (url === '/v1/scheduling/calendar-link' && method === 'PATCH' && current !== null) {
        current = { ...current, withShifts: z.object({ withShifts: z.boolean() }).parse(body).withShifts };
        return Promise.resolve(new Response(JSON.stringify({ link: current }), { status: 200 }));
      }
      if (url === '/v1/scheduling/calendar-link')
        return Promise.resolve(new Response(JSON.stringify({ link: current }), { status: 200 }));
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoneDialog onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Mon agenda dans mon téléphone » (CR-05, ADR 0045 § 5)', () => {
  it('adds who answers her fans to her link when she turns it on', async () => {
    const calls = serve({ createdAt: '2026-11-01T10:00:00.000Z', withShifts: false });
    show();
    const choice = await screen.findByRole('switch', { name: /Qui répond à tes fans/u });
    expect(choice).toHaveProperty('checked', false);
    fireEvent.click(choice);
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ withShifts: true });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveProperty('checked', true);
    });
  });

  it('offers the choice only once her link exists', async () => {
    serve(null);
    show();
    expect(await screen.findByRole('button', { name: 'Créer mon lien' })).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
