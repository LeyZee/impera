// @vitest-environment jsdom
import { ProposePersonaCorrectionBodySchema, type PersonaV2 } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import demoYaml from '../../../../personas/demo/v0.3.0.yaml?raw';

import { MyPersonaPage } from './MyPersonaPage';
import { parsePersonaYaml } from './persona/source';

const CREATOR = '0199f2a0-0000-7000-8000-0000000000c1';

/** An invented creator (ADR 0010): the demo's sheet, her life left unwritten, a panel half written. */
let DEMO: PersonaV2;
const sheetOf = (demo: PersonaV2): PersonaV2['sheet'] => ({
  ...demo.sheet,
  lifestyle: {
    ...demo.sheet.lifestyle,
    ...Object.fromEntries(Object.keys(demo.sheet.lifestyle).map((key) => [key, null])),
  },
  preferences: { ...demo.sheet.preferences, favorite_books: null, religion: null },
});

beforeAll(async () => {
  DEMO = await parsePersonaYaml(demoYaml);
});

let sheet: unknown;
const asked: string[] = [];
/** Her corrections as the server holds them, and what each POST sent. */
let corrections: object[] = [];
const sent: { id: string; section: string; text: string }[] = [];
let refuse: number | null = null;

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      asked.push(url.pathname);
      if (url.pathname === `/v1/creators/${CREATOR}/persona/corrections`) {
        if (init?.method === 'POST') {
          if (refuse !== null) {
            const error = { code: 'persona_corrections_limited', message: '…', details: {}, requestId: 'r' };
            return Promise.resolve(new Response(JSON.stringify({ error }), { status: refuse }));
          }
          const body = ProposePersonaCorrectionBodySchema.parse(
            JSON.parse(typeof init.body === 'string' ? init.body : '{}'),
          );
          sent.push(body);
          const stored = { ...body, state: 'open', createdAt: '2026-11-06T09:00:00.000Z', doneAt: null };
          corrections = [stored, ...corrections];
          return Promise.resolve(new Response(JSON.stringify(stored), { status: 201 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ corrections })));
      }
      if (url.pathname === '/v1/creators') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              creators: [{ id: CREATOR, displayName: 'Elena', timezone: 'Europe/Paris', nameKey: 'elena' }],
            }),
          ),
        );
      }
      if (url.pathname === `/v1/creators/${CREATOR}/persona/mine`) {
        return Promise.resolve(
          new Response(JSON.stringify({ creatorId: CREATOR, sheet: null, answers: sheet })),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/moi/persona', component: MyPersonaPage });
  const others = ['/moi/securite', '/moi/preferences'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/persona'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  asked.length = 0;
  sent.length = 0;
  corrections = [];
  refuse = null;
  sheet = sheetOf(DEMO);
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Persona (recette CREA-01)', () => {
  it('reads her sheet, in her words, with nothing to change and no word of the agent', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Identité et informations de base' })).toBeTruthy();
    expect(screen.getByText('Elena')).toBeTruthy();
    expect(screen.getByText('Français, Espagnol, Anglais')).toBeTruthy();
    expect(screen.getByText(DEMO.sheet.boundaries.off_limits ?? '')).toBeTruthy();
    // Her age, never her date of birth; her time zone is the agency's (Heures d'activité).
    expect(screen.queryByText(/2001/u)).toBeNull();
    expect(screen.queryByText('Fuseau horaire')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/enregistrer|activer/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/agent|IA\b|relance|stratégie|notification/i);
    // Only her door: never the agency's sheet and its history.
    expect(asked).not.toContain(`/v1/creators/${CREATOR}/persona`);
  });

  it('leaves out what is not written, and says it once for a block with nothing', async () => {
    renderPage();
    const life = await screen.findByRole('region', { name: 'Mode de vie' });
    expect(life.textContent).toContain('Rien d’écrit pour l’instant.');
    const tastes = screen.getByRole('region', { name: 'Préférences' });
    expect(tastes.textContent).toContain('Passions');
    expect(tastes.textContent).not.toContain('Livres préférés');
    expect(tastes.textContent).not.toContain('Religion');
    expect(screen.getAllByText('Rien d’écrit pour l’instant.')).toHaveLength(1);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Identité et informations de base',
      'Mode de vie',
      'Préférences',
      'Style de conversation',
      'Relations',
      'Intimité',
      'Zones interdites',
    ]);
  });

  it('sends a correction of one block to the agency, once, and shows it waiting there (CREA-01 b)', async () => {
    renderPage();
    const tastes = await screen.findByRole('region', { name: 'Préférences' });
    fireEvent.click(within(tastes).getByRole('button', { name: 'Proposer une correction' }));
    const field = within(tastes).getByRole('textbox', { name: 'Ce qui ne te ressemble pas' });
    expect(document.activeElement).toBe(field);
    // Nothing typed, nothing sent.
    fireEvent.click(within(tastes).getByRole('button', { name: 'Envoyer à l’agence' }));
    expect(sent).toEqual([]);

    fireEvent.change(field, { target: { value: '  Plutôt le thé que le café.  ' } });
    const send = within(tastes).getByRole('button', { name: 'Envoyer à l’agence' });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(await within(tastes).findByText('Plutôt le thé que le café.', { selector: 'p' })).toBeTruthy();
    expect(sent.map(({ section, text }) => [section, text])).toEqual([
      ['preferences', 'Plutôt le thé que le café.'],
    ]);
    expect(within(tastes).getByText(/Envoyée le 6\snov\. · l’agence la lit/)).toBeTruthy();
    expect(within(tastes).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(
      within(tastes).getByRole('button', { name: 'Proposer une correction' }),
    );
    // Only under its block.
    expect(screen.getByRole('region', { name: 'Zones interdites' }).textContent).not.toContain('thé');
    expect(document.body.textContent).not.toMatch(/agent|IA\b|relance|stratégie|notification/i);
  });

  it('says why a correction does not leave, and keeps what she typed', async () => {
    refuse = 429;
    renderPage();
    const limits = await screen.findByRole('region', { name: 'Zones interdites' });
    fireEvent.click(within(limits).getByRole('button', { name: 'Proposer une correction' }));
    const field = within(limits).getByRole('textbox', { name: 'Ce qui ne te ressemble pas' });
    fireEvent.change(field, { target: { value: 'Plus de pieds du tout.' } });
    fireEvent.click(within(limits).getByRole('button', { name: 'Envoyer à l’agence' }));
    expect((await within(limits).findByRole('alert')).textContent).toMatch(/attendent déjà l’agence/);
    expect(within(limits).getByRole('textbox')).toHaveProperty('value', 'Plus de pieds du tout.');
  });

  it('keeps what she typed when Échap closes the form, and drops it on « Annuler »', async () => {
    renderPage();
    const life = await screen.findByRole('region', { name: 'Mode de vie' });
    const open = () => {
      fireEvent.click(within(life).getByRole('button', { name: 'Proposer une correction' }));
      return within(life).getByRole('textbox');
    };
    fireEvent.change(open(), { target: { value: 'J’habite à Annecy.' } });
    fireEvent.keyDown(within(life).getByRole('textbox'), { key: 'Escape' });
    expect(within(life).queryByRole('textbox')).toBeNull();
    expect(open()).toHaveProperty('value', 'J’habite à Annecy.');
    fireEvent.click(within(life).getByRole('button', { name: 'Annuler' }));
    expect(open()).toHaveProperty('value', '');
    expect(sent).toEqual([]);
  });

  it('shows a correction the agency handled as taken, one of the former blocks under the panel that took it over', async () => {
    corrections = [
      {
        id: '0199f2a0-0000-7000-8000-00000000c0f1',
        section: 'details',
        text: 'Je fais du pilates, plus du yoga.',
        state: 'done',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        doneAt: new Date().toISOString(),
      },
    ];
    renderPage();
    const who = await screen.findByRole('region', { name: 'Identité et informations de base' });
    expect(await within(who).findByText('Je fais du pilates, plus du yoga.')).toBeTruthy();
    expect(within(who).getByText(/^Prise en compte le /)).toBeTruthy();
  });

  it('says her sheet is being prepared while she has none', async () => {
    sheet = null;
    renderPage();
    expect(await screen.findByText('Ta fiche est en préparation')).toBeTruthy();
  });
});
