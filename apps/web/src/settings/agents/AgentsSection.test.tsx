// @vitest-environment jsdom
import { McpGrantSchema, REAUTHENTICATION_ERROR_CODE } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentsSection, claudeCodeCommand, grantState, labelProblem, serverUrl } from './AgentsSection';
import { CAPABILITY_CHOICES } from './capabilities';

/** Invented accesses and an invented token: nothing real. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const LIVE = McpGrantSchema.parse({
  id: id(71),
  label: 'Claude du PC',
  creatorId: null,
  capabilities: ['read:status', 'read:sales'],
  createdAt: '2026-11-20T09:00:00Z',
  expiresAt: '2099-12-20T09:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
});
const REVOKED = McpGrantSchema.parse({
  ...LIVE,
  id: id(72),
  label: 'Essai',
  revokedAt: '2026-11-21T09:00:00Z',
});
// Shaped like a token (the prefix, then 43 base64url characters), plainly not one.
const TOKEN = `impmcp_${'x'.repeat(43)}`;

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake API, each answer taken in turn for its `METHOD path`. */
function serve(routes: Record<string, Reply[]>): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, path: url, body });
      const queue = routes[`${method} ${url}`];
      const reply = (queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const GRANTS = '/v1/settings/mcp-grants';
const CREATORS: Reply = {
  status: 200,
  body: { creators: [{ id: id(2), displayName: 'Lune', timezone: 'Europe/Paris' }] },
};

function show(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentsSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the rules of the screen', () => {
  it('asks for a name of 40 characters at most', () => {
    expect(labelProblem('  ')).toBe('Donne un nom à cet agent.');
    expect(labelProblem('x'.repeat(41))).toBe('40 caractères au plus.');
    expect(labelProblem('Claude du PC')).toBeNull();
  });

  it('gives the server’s address and the line for Claude Code', () => {
    const url = serverUrl('http://localhost:5173');
    expect(url).toBe('http://localhost:5173/v1/mcp');
    expect(claudeCodeCommand(url, TOKEN)).toBe(
      `claude mcp add --transport http impera http://localhost:5173/v1/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('tells a live access from a revoked or an expired one', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(grantState(LIVE, now)).toBe('live');
    expect(grantState(REVOKED, now)).toBe('revoked');
    expect(grantState(McpGrantSchema.parse({ ...LIVE, expiresAt: '2026-11-25T00:00:00Z' }), now)).toBe(
      'expired',
    );
  });

  it('offers reads only: no gesture is ever ticked here', () => {
    expect(CAPABILITY_CHOICES.every((choice) => choice.capability.startsWith('read:'))).toBe(true);
  });
});

describe('Réglages › Agents connectés', () => {
  it('lists the live accesses and keeps the revoked ones folded apart', async () => {
    serve({
      [`GET ${GRANTS}`]: [{ status: 200, body: { items: [LIVE, REVOKED] } }],
      'GET /v1/creators': [CREATORS],
    });
    show();
    const live = await screen.findByRole('list', { name: 'Agents connectés' });
    expect(within(live).getByText('Claude du PC')).toBeTruthy();
    expect(within(live).getByText('Chiffres et état')).toBeTruthy();
    expect(within(live).getByText('Ventes')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Agents révoqués ou expirés' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voir les révoqués ou expirés (1)' }));
    const past = screen.getByRole('list', { name: 'Agents révoqués ou expirés' });
    expect(within(past).getByText(/Essai · révoqué le/u)).toBeTruthy();
  });

  it('ticks the accounting reads in one tap, and names the agent', async () => {
    const calls = serve({
      [`GET ${GRANTS}`]: [{ status: 200, body: { items: [] } }],
      [`POST ${GRANTS}`]: [{ status: 201, body: { ...LIVE, token: TOKEN } }],
      'GET /v1/creators': [CREATORS],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter un agent' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Comptabilité/u }));
    expect(screen.getByLabelText('Résumé').textContent).toBe(
      'Comptabilité lira « Ventes » et « Chiffres et état », pour toute l’agence, pendant 30 jours. Il ne pourra rien écrire.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer le jeton' }));
    expect(await screen.findByLabelText('Jeton de l’agent')).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      label: 'Comptabilité',
      creatorId: null,
      capabilities: ['read:sales', 'read:status'],
      days: 30,
    });
  });

  it('ticks nothing by default and sends only what the owner ticked', async () => {
    const calls = serve({
      [`GET ${GRANTS}`]: [{ status: 200, body: { items: [] } }],
      [`POST ${GRANTS}`]: [{ status: 201, body: { ...LIVE, capabilities: ['read:sales'], token: TOKEN } }],
      'GET /v1/creators': [CREATORS],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter un agent' }));
    const switches = screen.getAllByRole('switch');
    expect(
      switches.every((one) => one.getAttribute('aria-checked') !== 'true' && !one.matches(':checked')),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Nom de l’agent'), { target: { value: 'Clairière' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le jeton' }));
    expect(await screen.findByText('Coche au moins une lecture.')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /^Ventes/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer le jeton' }));
    expect(await screen.findByLabelText('Jeton de l’agent')).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      label: 'Clairière',
      creatorId: null,
      capabilities: ['read:sales'],
      days: 30,
    });
    expect(screen.getByLabelText('Commande pour Claude Code').textContent).toContain(`Bearer ${TOKEN}`);
  });

  it('says in amber what leaves for the agent’s provider when a text is ticked', async () => {
    serve({ [`GET ${GRANTS}`]: [{ status: 200, body: { items: [] } }], 'GET /v1/creators': [CREATORS] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter un agent' }));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: /^Messages et brouillons/u }));
    expect(screen.getByRole('note').textContent).toContain(
      'jamais à un agent qui lance des commandes, envoie un e-mail ou écrit quelque part.',
    );
  });

  it('asks for the password and a code when the sign-in is old', async () => {
    serve({
      [`GET ${GRANTS}`]: [{ status: 200, body: { items: [] } }],
      [`POST ${GRANTS}`]: [{ status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) }],
      'GET /v1/creators': [CREATORS],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter un agent' }));
    fireEvent.change(screen.getByLabelText('Nom de l’agent'), { target: { value: 'Claude du PC' } });
    fireEvent.click(screen.getByRole('switch', { name: /^Chiffres et état/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer le jeton' }));
    expect(
      await screen.findByText('Pour créer ce jeton, confirme ton mot de passe et ton code.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Jeton de l’agent')).toBeNull();
  });

  it('revokes after a confirmation', async () => {
    const calls = serve({
      [`GET ${GRANTS}`]: [
        { status: 200, body: { items: [LIVE] } },
        { status: 200, body: { items: [{ ...LIVE, revokedAt: '2026-11-26T10:00:00Z' }] } },
      ],
      [`DELETE ${GRANTS}/${LIVE.id}`]: [{ status: 204 }],
      'GET /v1/creators': [CREATORS],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));
    expect(screen.getByText('Révoquer pour de bon ?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Révoquer' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
    expect(await screen.findByText('Claude du PC est révoqué : son jeton n’ouvre plus rien.')).toBeTruthy();
  });
});
