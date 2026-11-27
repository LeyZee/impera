// @vitest-environment jsdom
import { ToAgencyMessagesSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToAgencyCard } from './ToAgencyCard';
import { answerRefusal, messageLines } from './model';

/* The address's anchor, as TanStack Router hands it (without its « # »). */
const at = vi.hoisted(() => ({ hash: '' }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: <T,>({ select }: { select: (location: { hash: string }) => T }): T =>
    select({ hash: at.hash }),
}));

/* An invented creator (ADR 0010). */
const message = (n: number, answer: string | null) => ({
  id: `0199f2a0-0000-4000-8000-00000000090${String(n)}`,
  creatorId: '0199f2a0-0000-7000-8000-000000000001',
  kind: n === 1 ? 'question' : 'worry',
  body: n === 1 ? 'Je peux décaler mon tournage ?' : 'Mon éclairage est cassé',
  createdAt: '2026-11-04T09:00:00.000Z',
  answer,
  answeredAt: answer === null ? null : '2026-11-04T10:00:00.000Z',
});

function show(messages: object[]) {
  const posted: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(typeof init.body === 'string' ? init.body : 'null'));
        return Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
      }
      return Promise.resolve(
        url === '/v1/creator-space/messages'
          ? Response.json({ messages })
          : new Response('null', { status: 404 }),
      );
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToAgencyCard />
    </QueryClientProvider>,
  );
  return posted;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  at.hash = '';
});

describe('« Écrire à l’agence » (trous béants n° 13)', () => {
  it('shows her last messages, each with the agency’s answer or « En attente »', async () => {
    show([message(1, 'Oui, samedi'), message(2, null)]);
    expect(await screen.findByRole('heading', { name: 'Écrire à l’agence' })).toBeTruthy();
    expect(screen.getByText('Une question')).toBeTruthy();
    expect(screen.getByText('Un souci')).toBeTruthy();
    expect(screen.getByText('Oui, samedi')).toBeTruthy();
    expect(screen.getByText('En attente de réponse')).toBeTruthy();
  });

  it('comes into view once loaded when the answer’s notification opens it (MOD-05)', async () => {
    const seen = vi.fn();
    Element.prototype.scrollIntoView = seen;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    at.hash = 'agence';
    show([message(1, 'Oui, samedi')]);
    expect(await screen.findByText('Oui, samedi')).toBeTruthy();
    expect(document.getElementById('agence')?.tagName).toBe('SECTION');
    // « Réduire les animations » on: it jumps, it does not glide.
    expect(seen).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
  });

  it('stays where it is on a plain visit to Aujourd’hui', async () => {
    const seen = vi.fn();
    Element.prototype.scrollIntoView = seen;
    show([message(1, 'Oui, samedi')]);
    expect(await screen.findByText('Oui, samedi')).toBeTruthy();
    expect(seen).not.toHaveBeenCalled();
  });

  it('sends her kind and her words once, with an id chosen once', async () => {
    const posted = show([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Écrire à l’agence' }));
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Envoyer' });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Une idée' }));
    fireEvent.change(screen.getByLabelText('Ton message'), { target: { value: '  Un tournage au lac  ' } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toMatchObject({ kind: 'idea', body: 'Un tournage au lac' });
    expect(await screen.findByText('C’est parti. On te répond ici.')).toBeTruthy();
  });

  it('keeps three messages on her card, and says an answer refused in words', () => {
    const four = ToAgencyMessagesSchema.parse({
      messages: [message(1, null), message(2, null), message(3, null), message(4, null)],
    }).messages;
    expect(messageLines(four)).toHaveLength(3);
    expect(answerRefusal('creator_message_answered_conflict')).toContain('déjà sa réponse');
  });
});
