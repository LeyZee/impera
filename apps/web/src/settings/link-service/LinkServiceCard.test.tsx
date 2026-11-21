// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinkServiceCard } from './LinkServiceCard';

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/* An invented key: it opens nothing anywhere. */
const PASTED = 'inventee-pour-le-test';
const NOT_CONNECTED = { state: 'not_connected', connectedAt: null };
const CONNECTED = { state: 'connected', connectedAt: '2026-11-02T13:05:00.000Z' };

function serve(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      const call = { method: init?.method ?? 'GET', path: new URL(input, 'http://localhost').pathname, body };
      calls.push(call);
      return Promise.resolve(answer(call));
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Plateformes, the redirect service key (INS-02)', () => {
  it('keeps a pasted key the service accepts, and never shows it again', async () => {
    const calls = serve((call) => json(call.method === 'PUT' ? CONNECTED : NOT_CONNECTED));
    render(<LinkServiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    const field = screen.getByLabelText<HTMLInputElement>('Clé du service de liens');
    expect(field.type).toBe('text');
    fireEvent.paste(field, { clipboardData: { getData: () => ` ${PASTED}\n` } });
    expect(await screen.findByText(/Clé acceptée par le service, connectée le 2 nov\./u)).toBeDefined();
    expect(calls[1]).toEqual({ method: 'PUT', path: '/v1/settings/link-service/key', body: { key: PASTED } });
    expect(screen.queryByLabelText('Clé du service de liens')).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASTED);
    expect(screen.getByRole('button', { name: 'Remplacer la clé' })).toBeDefined();
  });

  it('says why the service refused a key, and keeps the field open', async () => {
    serve((call) =>
      call.method === 'PUT'
        ? json(
            {
              error: {
                code: 'link_service_unprocessable',
                message: 'Le service de liens refuse cette clé. Vérifie que tu as collé la clé entière.',
                details: { kind: 'unauthorized' },
                requestId: 'r1',
              },
            },
            422,
          )
        : json(NOT_CONNECTED),
    );
    render(<LinkServiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    fireEvent.paste(screen.getByLabelText('Clé du service de liens'), {
      clipboardData: { getData: () => PASTED },
    });
    expect(await screen.findByText(/Le service de liens refuse cette clé/u)).toBeDefined();
    expect(screen.getByLabelText('Clé du service de liens')).toBeDefined();
  });

  it('asks the password and the code before a key is kept when the sign-in is old', async () => {
    serve((call) =>
      call.method === 'PUT'
        ? json(
            { error: { code: REAUTHENTICATION_ERROR_CODE, message: 'x', details: {}, requestId: 'r1' } },
            403,
          )
        : json(NOT_CONNECTED),
    );
    render(<LinkServiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    fireEvent.paste(screen.getByLabelText('Clé du service de liens'), {
      clipboardData: { getData: () => PASTED },
    });
    expect(
      await screen.findByText(
        'Pour connecter la clé du service de liens, confirme ton mot de passe et ton code.',
      ),
    ).toBeDefined();
  });

  it('removes the key only after « Retirer la clé » is confirmed', async () => {
    const calls = serve((call) => json(call.method === 'DELETE' ? NOT_CONNECTED : CONNECTED));
    render(<LinkServiceCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }));
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la clé' }));
    expect(await screen.findByText(/^Aucune clé\./u)).toBeDefined();
    await waitFor(() => {
      expect(calls[1]).toEqual({ method: 'DELETE', path: '/v1/settings/link-service', body: null });
    });
  });

  it('offers no field on a server that has no address for the service', async () => {
    serve(() => json({ state: 'off', connectedAt: null }));
    render(<LinkServiceCard />);
    expect(await screen.findByText(/elle se règle au déploiement/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: /clé/u })).toBeNull();
  });

  it('stays silent for a member who is not the owner', async () => {
    serve(() => json({ error: { code: 'role_forbidden', message: 'x', details: {}, requestId: 'r1' } }, 403));
    const { container } = render(<LinkServiceCard />);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    expect(container.innerHTML).toBe('');
  });
});
