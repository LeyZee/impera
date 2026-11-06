// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtensionLinksPanel, labelProblem, suggestedLabel } from './ExtensionLinksPanel';

/** Invented links and an invented token: nothing real. */
const LINK_A = {
  id: '0b7c5c2e-4c1f-4b8e-9a0e-1f2a3b4c5d6e',
  label: 'Chrome du bureau',
  createdAt: '2026-11-01T09:00:00Z',
  lastUsedAt: null,
};
const LINK_B = {
  id: '1c8d6d3f-5d2a-4c9f-8b1f-2a3b4c5d6e7f',
  label: 'Edge',
  createdAt: '2026-11-02T09:00:00Z',
  lastUsedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
};
const LINK_C = { ...LINK_B, id: '2d9e7e4a-6e3b-4d0a-9c2a-3b4c5d6e7f80', label: 'Firefox' };
// Shaped like a token (43 base64url characters), plainly not one: no secret scanner reads it as a key.
const TOKEN = 'x'.repeat(43);

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1/trends/extension-links`, each answer taken in turn for its `METHOD path`. */
function serve(routes: Record<string, Reply[]>): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1\/trends\/extension-links/u, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const queue = routes[`${method} ${path}`];
      const reply = (queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0]) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the rules of the panel', () => {
  it('names the browser from where the page runs', () => {
    expect(
      suggestedLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0'),
    ).toBe('Edge');
    expect(
      suggestedLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'),
    ).toBe('Chrome');
    expect(suggestedLabel('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe(
      'Firefox',
    );
    expect(suggestedLabel('curl/8')).toBe('Mon navigateur');
  });

  it('wants a name of 40 characters at most', () => {
    expect(labelProblem('  ')).toBe('Donne un nom à ce navigateur.');
    expect(labelProblem('x'.repeat(41))).toBe('40 caractères au plus.');
    expect(labelProblem('Chrome du salon')).toBeNull();
  });
});

describe('Relier l’extension', () => {
  it('lists the linked browsers with when each last sent something', async () => {
    serve({ 'GET ': [{ status: 200, body: { items: [LINK_A, LINK_B] } }] });
    render(<ExtensionLinksPanel />);
    const list = await screen.findByRole('list', { name: 'Navigateurs reliés' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Chrome du bureau');
    expect(rows[0]?.textContent).toContain('rien reçu encore');
    expect(rows[1]?.textContent).toContain('dernier envoi il y a 12 min');
  });

  it('links a browser and shows its code once', async () => {
    const calls = serve({
      'GET ': [
        { status: 200, body: { items: [] } },
        { status: 200, body: { items: [{ ...LINK_A, label: 'Chrome du salon' }] } },
      ],
      'POST ': [
        {
          status: 201,
          body: { id: LINK_A.id, label: 'Chrome du salon', createdAt: LINK_A.createdAt, token: TOKEN },
        },
      ],
    });
    render(<ExtensionLinksPanel />);
    await screen.findByText('Aucun navigateur relié.');
    fireEvent.click(screen.getByRole('button', { name: 'Relier un navigateur' }));
    const field = screen.getByLabelText('Nom de ce navigateur');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Relier' }));
    expect(screen.getByText('Donne un nom à ce navigateur.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    fireEvent.change(field, { target: { value: ' Chrome du salon ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Relier' }));
    expect((await screen.findByLabelText('Code de liaison')).textContent).toBe(TOKEN);
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ label: 'Chrome du salon' });
    expect(screen.getByText('Code pour Chrome du salon')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'C’est collé' }));
    expect(screen.queryByLabelText('Code de liaison')).toBeNull();
  });

  it('says the three browsers are linked instead of offering a fourth', async () => {
    serve({ 'GET ': [{ status: 200, body: { items: [LINK_A, LINK_B, LINK_C] } }] });
    render(<ExtensionLinksPanel />);
    expect(await screen.findByText(/3 navigateurs sont reliés/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Relier un navigateur' })).toBeNull();
  });

  it('says why the server refused a link', async () => {
    serve({
      'GET ': [{ status: 200, body: { items: [] } }],
      'POST ': [{ status: 409, body: apiError('extension_links_full_conflict') }],
    });
    render(<ExtensionLinksPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Relier un navigateur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Relier' }));
    expect(
      await screen.findByText('Trois navigateurs sont déjà reliés : délies-en un d’abord.'),
    ).toBeTruthy();
  });

  it('unlinks a browser after asking, and can keep it', async () => {
    const calls = serve({
      'GET ': [
        { status: 200, body: { items: [LINK_A, LINK_B] } },
        { status: 200, body: { items: [LINK_B] } },
      ],
      [`DELETE /${LINK_A.id}`]: [{ status: 204 }],
    });
    render(<ExtensionLinksPanel />);
    const list = await screen.findByRole('list', { name: 'Navigateurs reliés' });
    const first = within(list).getAllByRole('listitem')[0];
    if (first === undefined) throw new Error('row expected');
    fireEvent.click(within(first).getByRole('button', { name: 'Délier' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Garder' }));
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    fireEvent.click(within(first).getByRole('button', { name: 'Délier' }));
    expect(within(first).getByText(/Délier ce navigateur/u)).toBeTruthy();
    fireEvent.click(within(first).getByRole('button', { name: 'Délier' }));
    expect(
      await screen.findByText('Chrome du bureau est délié : son extension n’envoie plus rien.'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: 'Navigateurs reliés' })).getAllByRole('listitem'),
      ).toHaveLength(1);
    });
  });

  it('says when the links cannot be read', async () => {
    serve({ 'GET ': [{ status: 500 }] });
    render(<ExtensionLinksPanel />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le serveur ne répond pas. Réessaie dans un instant.',
    );
    expect(screen.queryByRole('button', { name: 'Relier un navigateur' })).toBeNull();
  });
});
