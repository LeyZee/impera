// @vitest-environment jsdom
import {
  MEDIA_VOCABULARY_VERSION,
  type Me,
  type PlaygroundAnswer,
  type PlaygroundState,
} from '@impera/contracts';
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
  shiftCreatorIds: [],
  role: 'owner',
  team: null,
  teamScope: 'owner',
  preferences: { sounds: true },
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
  desireThresholds: { open: 40, script: 70 },
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
  persona: { name: 'Elena', played: null },
  pending: null,
  scripts: { source: 'trial', unavailable: null, run: null, fictiveSpentCents: 0, salesFrozen: false },
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Chatting' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Fan fictif')).toBeTruthy();
    });
    expect(calls.filter((c) => c === 'GET /v1/playground')).toHaveLength(2);
  });

  it('shows her bubbles one by one, « Elle écrit… » between them, and nothing to rate before the last (Charles, 16/11)', async () => {
    const answered: PlaygroundState = {
      ...BASE,
      history: [
        { index: 0, from: 'fan', text: 'Salut' },
        { index: 1, from: 'creator', text: 'Coucou toi\nTu fais quoi ?' },
      ],
      pending: { ...ANSWER, bubbles: ['Coucou toi', 'Tu fais quoi ?'], delaysMs: [0, 400], latencyMs: 0 },
    };
    answer = (method, path) => {
      if (method === 'POST' && path === '/v1/playground/messages') return json(200, answered.pending);
      if (method === 'GET' && path === '/v1/playground')
        return json(200, calls.includes('POST /v1/playground/messages') ? answered : BASE);
      return undefined;
    };
    open();
    const box = await screen.findByPlaceholderText(/Écris comme/);
    fireEvent.change(box, { target: { value: 'Salut' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Coucou toi')).toBeTruthy();
    expect(screen.queryByText('Tu fais quoi ?')).toBeNull();
    expect(screen.getByText('Elle écrit…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Valider/ })).toBeNull();
    // Nothing to rate yet: the box says she writes, not « Note d’abord la réponse » (avis Design 16/11).
    expect(screen.getByPlaceholderText('Elle écrit…')).toBeTruthy();
    expect(await screen.findByText('Tu fais quoi ?')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Valider/ })).toBeTruthy();
  });

  it('shows the brain’s reading while the voice still writes (two steps)', async () => {
    const reading = {
      intent: 'flirt' as const,
      sentiment: 'positive',
      risks: [],
      action: 'reply',
      replyBrief: '',
      kycMissing: [],
    };
    answer = (method, path) => {
      // The voice never finishes in this test: the answer stays on its way.
      if (method === 'POST' && path === '/v1/playground/messages') return undefined;
      if (method === 'GET' && path === '/v1/playground')
        return json(200, calls.includes('POST /v1/playground/messages') ? { ...BASE, reading } : BASE);
      return undefined;
    };
    open();
    const box = await screen.findByPlaceholderText(/Écris comme/);
    fireEvent.change(box, { target: { value: 'T’es trop belle' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Elle a lu :', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('Elle écrit…')).toBeTruthy();
    // His message leaves the box as he sends it and shows in the thread, before the server sends it back.
    expect(screen.getByText('T’es trop belle')).toBeTruthy();
    expect(box).toHaveProperty('value', '');
  });

  it('says the server does not answer on a bare 503, and names Grok only when the server says so (V-ETA-06)', async () => {
    answer = (method, path) => (method === 'GET' && path === '/v1/playground' ? json(503, null) : undefined);
    open();
    const title = await screen.findByText('Le serveur ne répond pas');
    expect(title.classList.contains('is-warn')).toBe(true);
    expect(screen.queryByText(/Grok/)).toBeNull();
    expect(screen.getByText('Réessaie dans un instant.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    cleanup();
    answer = (method, path) =>
      method === 'GET' && path === '/v1/playground' ? failure(503, 'llm_unavailable') : undefined;
    open();
    expect(await screen.findByText('Grok ne répond pas')).toBeTruthy();
    expect(screen.getByText('Ajoute ou vérifie sa clé dans Réglages › Modèles IA.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir Modèles IA' }).getAttribute('href')).toBe(
      '/reglages/modeles-ia',
    );
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
    const header = await screen.findByText('Elena, fictive', { selector: '.pg-top__persona' });
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

  it('offers « Payer (fictif) » and « Refuser » on the paid step of a trial script waiting (ADR 0103 § 16)', async () => {
    type Media = NonNullable<PlaygroundState['history'][number]['media']>[number];
    const media = (kind: 'free' | 'paid', isLocked: boolean, state: 'offered' | 'waiting'): Media => ({
      description: {
        vocabularyVersion: MEDIA_VOCABULARY_VERSION,
        kind: 'image',
        factualDescription: 'Photo d’elle sur le canapé, lumière tamisée.',
        durationS: null,
        segments: [],
        intensity: 'not_visible',
        anatomyVisible: [],
        castMode: 'not_visible',
        mood: [],
        setting: null,
        audio: null,
        textVisible: null,
        quality: 'acceptable',
        confidenceLow: true,
        notVisible: false,
        flags: [],
      },
      isLocked,
      scriptStep: {
        source: 'trial',
        scriptRef: 'essai-nuit',
        stepIndex: kind === 'free' ? 0 : 1,
        kind,
        priceCents: kind === 'free' ? null : 1200,
        state,
      },
    });
    const state: PlaygroundState = {
      ...BASE,
      history: [
        { index: 0, from: 'fan', text: 'Montre-moi' },
        { index: 1, from: 'creator', text: '', media: [media('free', false, 'offered')] },
        { index: 2, from: 'creator', text: '', media: [media('paid', true, 'waiting')] },
      ],
      scripts: {
        source: 'trial',
        unavailable: null,
        run: {
          scriptRef: 'essai-nuit',
          name: 'Essai · Nuit',
          source: 'trial',
          description: 'Fin de soirée.',
          moment: 'night',
          status: 'open',
          steps: [
            { kind: 'free', priceCents: null, outcome: 'sent' },
            { kind: 'paid', priceCents: 1200, outcome: 'sent' },
          ],
        },
        fictiveSpentCents: 0,
        salesFrozen: false,
      },
    };
    answer = (method, path) =>
      method === 'GET' && path === '/v1/playground'
        ? json(200, state)
        : method === 'POST' && path === '/v1/playground/script/buy'
          ? json(200, state)
          : undefined;
    open();
    expect(await screen.findByLabelText('Script d’essai')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Payer 12/ }));
    await waitFor(() => {
      expect(calls).toContain('POST /v1/playground/script/buy');
    });
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeTruthy();
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
      await screen.findByText('Rangée en Exemple de voix : sa voix s’en sert, ici et avec ses vrais fans.'),
    ).toBeTruthy();
  });
});
