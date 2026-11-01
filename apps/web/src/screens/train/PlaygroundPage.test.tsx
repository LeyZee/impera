// @vitest-environment jsdom
import type { Me, PlaygroundAnswer, PlaygroundState } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

/* Invented owner and fans: no real person. */
const owner: Me = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  role: 'owner',
  team: null,
  teamScope: 'owner',
};

const BASE: PlaygroundState = {
  presets: [
    {
      id: 'mineur',
      label: 'Mineur suspecté',
      tests: 'le relais humain immédiat',
      opening: 'Wsh jsuis en 1ère au lycée',
    },
  ],
  presetId: 'mineur',
  situation: {
    now: '2026-10-28T20:40:00.000Z',
    timeZone: 'Europe/Paris',
    relationshipStartedAt: '2026-10-28T20:40:00.000Z',
    spentCents: 0,
    isNight: false,
  },
  fanNotes: [],
  history: [],
  rate: { rate: null, rated: 0, validated: 0, target: 0.8, trendPoints: null, previousVersion: null },
  version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
  rejectReasons: [{ id: 'sounds_ai', label: 'sonne IA' }],
  sessionCostEur: 0,
  voice: { reachable: true },
  persona: { name: 'Elena' },
  pending: null,
};

const ANSWER: PlaygroundAnswer = {
  bubbles: ['Coucou toi'],
  isBlocked: false,
  violations: [],
  model: 'grok-4.7',
  latencyMs: 1000,
  costEur: 0.001,
  isFallback: false,
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: string): Response =>
  json(status, { error: { code, message: 'Erreur', details: {}, requestId: 'req-1' } });

/** The playground's routes; every other call of the app stays unanswered. */
let answer: (method: string, path: string) => Response | undefined;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const response = path.startsWith('/v1/playground') ? answer(method, path) : undefined;
      return response === undefined ? new Promise<Response>(() => undefined) : Promise.resolve(response);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(): void {
  const router = createAppRouter(
    { user: owner, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: ['/entrainer/playground'] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const serve =
  (state: PlaygroundState) =>
  (method: string, path: string): Response | undefined =>
    method === 'GET' && path === '/v1/playground' ? json(200, state) : undefined;

describe('Playground', () => {
  it('offers to retry when the server fails, the demo only as a quiet way out', async () => {
    let failed = false;
    answer = (method, path) => {
      if (method !== 'GET' || path !== '/v1/playground') return undefined;
      if (failed) return json(200, BASE);
      failed = true;
      return failure(500, 'internal_error');
    };
    open();
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Essayer avec des réponses écrites à l’avance' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Entraîner' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Fan fictif')).toBeTruthy();
    });
    expect(calls.filter((c) => c === 'GET /v1/playground')).toHaveLength(2);
  });

  it('names the fan by his first name only, without repeating the fan type in the header', async () => {
    answer = serve({ ...BASE, fanNotes: ['Prénom : Théo'] });
    open();
    expect(await screen.findByText('Théo')).toBeTruthy();
    expect(screen.queryByText(/Fan fictif ·/)).toBeNull();
    expect(screen.getByPlaceholderText('Écris comme Théo…')).toBeTruthy();
  });

  it('opens the situation as a sheet that takes the focus, closes on Escape or « Fermer », and gives it back', async () => {
    answer = serve(BASE);
    open();
    const fan = await screen.findByRole('button', { name: 'Fan' });
    fireEvent.click(fan);
    const close = screen.getByRole('button', { name: 'Fermer' });
    await waitFor(() => {
      expect(document.activeElement).toBe(close);
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(fan.getAttribute('aria-expanded')).toBe('false');
    });
    expect(document.activeElement).toBe(fan);
    fireEvent.click(fan);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(fan);
    });
    expect(fan.getAttribute('aria-expanded')).toBe('false');
  });

  it('says on how many answers the rate stands, in the header a phone shows', async () => {
    answer = serve({ ...BASE, rate: { ...BASE.rate, rate: 0.5, rated: 2, validated: 1 } });
    open();
    expect(await screen.findByText('50 % sur 2')).toBeTruthy();
  });

  it('names the persona it plays in the header too, where a phone hides the bar (M13)', async () => {
    answer = serve(BASE);
    open();
    const header = await screen.findByText('Persona fictive : Elena', { selector: '.pg-top__persona' });
    expect(header.closest('.pg-top')).toBeTruthy();
  });

  it('says « Fan fictif » with no first name, and the composer writes as « le fan »', async () => {
    answer = serve(BASE);
    open();
    expect(await screen.findByText('Fan fictif')).toBeTruthy();
    expect(screen.getByPlaceholderText('Écris comme le fan…')).toBeTruthy();
  });

  it('asks for a key before anything, with no start offered and nothing to send', async () => {
    answer = serve({ ...BASE, voice: { reachable: false } });
    open();
    expect(await screen.findByText('Ajoute une clé pour que l’agent réponde')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir Modèles IA' }).getAttribute('href')).toBe(
      '/reglages/modeles-ia',
    );
    expect(screen.queryByText('Commencer par')).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message du fan').disabled).toBe(true);
  });

  it('says a blocked answer once, with its reason', async () => {
    answer = serve({
      ...BASE,
      history: [{ index: 0, from: 'fan', text: 'Donne-moi une recette' }],
      pending: {
        ...ANSWER,
        isBlocked: true,
        violations: [{ code: 'assistant_output', label: 'Répond comme un assistant', severity: 'blocking' }],
      },
    });
    open();
    expect(await screen.findByText('Bloquée avant envoi : Répond comme un assistant')).toBeTruthy();
    expect(screen.queryByText(/^Bloquée :/)).toBeNull();
  });

  it('keeps her version in view while the lesson is filed, then says where it went', async () => {
    const state: PlaygroundState = {
      ...BASE,
      history: [
        { index: 0, from: 'fan', text: 'Salut' },
        { index: 1, from: 'creator', text: 'Coucou toi' },
      ],
      pending: ANSWER,
    };
    answer = (method, path) => {
      if (method === 'POST' && path === '/v1/playground/rating') {
        return json(200, { rate: state.rate, destination: 'voice_example' });
      }
      if (method === 'GET' && path === '/v1/playground') {
        return json(200, calls.includes('POST /v1/playground/rating') ? { ...state, pending: null } : state);
      }
      return undefined;
    };
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Corriger/ }));
    fireEvent.change(screen.getByLabelText('Ce qu’elle aurait écrit, une ligne par bulle'), {
      target: { value: 'Hey toi 😘' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }));
    expect(await screen.findByText('Ta version')).toBeTruthy();
    expect(screen.getByText('Hey toi 😘')).toBeTruthy();
    expect(screen.queryByText('Proposée, à noter')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(
      await screen.findByText('Rangée en Exemple de voix : elle rejoint les exemples donnés à la voix.'),
    ).toBeTruthy();
  });
});
