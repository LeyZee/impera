// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecuritySection } from './SecuritySection';
import { ago, closedText, sessionsText } from './view';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', () => ({
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/** Invented sessions and accounts: no real person, no real address. */
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const SESSIONS = [
  {
    id: 's-laptop',
    device: 'Chrome sur Windows',
    network: '198.51.100.x',
    createdAt: minutesAgo(600),
    lastActiveAt: minutesAgo(0),
    current: true,
  },
  {
    id: 's-phone',
    device: 'Safari sur iPhone',
    network: '203.0.113.x',
    createdAt: minutesAgo(3000),
    lastActiveAt: minutesAgo(180),
    current: false,
  },
  {
    id: 's-old',
    device: 'Appareil inconnu',
    network: null,
    createdAt: minutesAgo(9000),
    lastActiveAt: minutesAgo(4320),
    current: false,
  },
];
const ACCOUNTS = [
  {
    userId: 'u-owner',
    name: 'Lina',
    role: 'owner',
    secondFactor: true,
    sessions: 1,
    lastActiveAt: minutesAgo(0),
  },
  {
    userId: 'u-team',
    name: 'Noé',
    role: 'operator',
    secondFactor: false,
    sessions: 2,
    lastActiveAt: minutesAgo(30),
  },
];

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
type Route = (body: unknown) => Reply;

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1`: each `METHOD path` answered by its route, every call kept in `calls`. */
function serve(routes: Record<string, Route>): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

/** An element the test expects to be there. */
function present<T>(element: T | undefined): T {
  if (element === undefined) throw new Error('element expected');
  return element;
}

const sessionsRoute =
  (sessions: readonly unknown[]): Route =>
  () => ({ status: 200, body: { sessions } });

beforeEach(() => {
  confirmIdentity.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the words of the screen', () => {
  const now = new Date('2026-11-02T20:00:00Z');

  it('says when a session was last used', () => {
    expect(ago('2026-11-02T19:59:40Z', now)).toBe('à l’instant');
    expect(ago('2026-11-02T19:48:00Z', now)).toBe('il y a 12 min');
    expect(ago('2026-11-02T17:00:00Z', now)).toBe('il y a 3 h');
    expect(ago('2026-10-31T20:00:00Z', now)).toBe('il y a 2 j');
    // A clock a little ahead is never « dans ».
    expect(ago('2026-11-02T20:01:00Z', now)).toBe('à l’instant');
  });

  it('counts sessions and what closing them ended', () => {
    expect(sessionsText(0)).toBe('Aucune session ouverte');
    expect(sessionsText(1)).toBe('1 session ouverte');
    expect(sessionsText(3)).toBe('3 sessions ouvertes');
    expect(closedText(0, 0)).toBe('Aucune autre session n’était ouverte.');
    expect(closedText(1, 0)).toBe('1 session fermée.');
    expect(closedText(2, 1)).toBe('2 sessions fermées, et 1 appareil de confiance oublié.');
    expect(closedText(2, 3)).toBe('2 sessions fermées, et 3 appareils de confiance oubliés.');
  });
});

describe('SecuritySection (SEC-04)', () => {
  it('lists one’s sessions by device and network, never the address, and closes another one', async () => {
    let sessions = SESSIONS;
    const calls = serve({
      'GET /auth/sessions': () => ({ status: 200, body: { sessions } }),
      'DELETE /auth/sessions/s-phone': () => {
        sessions = sessions.filter((session) => session.id !== 's-phone');
        return { status: 204 };
      },
    });
    render(<SecuritySection owner={false} userId="u-team" />);

    const list = await screen.findByRole('list', { name: 'Sessions ouvertes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(present(rows[0])).getByText('Cet appareil')).toBeTruthy();
    expect(rows[0]?.textContent).toContain('Réseau 198.51.100.x · active à l’instant');
    expect(rows[1]?.textContent).toContain('Réseau 203.0.113.x · active il y a 3 h');
    expect(rows[2]?.textContent).toContain('Réseau inconnu · active il y a 3 j');
    // This device's session is closed by signing out, never from the list.
    expect(within(present(rows[0])).queryByRole('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer la session Safari sur iPhone' }));
    expect(await screen.findByText('Session fermée : cet appareil devra se reconnecter.')).toBeTruthy();
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/auth/sessions/s-phone',
    ]);
    // Moi › Sécurité: no accounts of the agency.
    expect(screen.queryByRole('heading', { name: 'Comptes de l’agence' })).toBeNull();
    expect(calls.some((call) => call.path.startsWith('/settings/security'))).toBe(false);
  });

  it('closes every other session after a confirmation, and says what it ended', async () => {
    let sessions = SESSIONS;
    const calls = serve({
      'GET /auth/sessions': () => ({ status: 200, body: { sessions } }),
      'POST /auth/sessions/close-others': () => {
        sessions = sessions.filter((session) => session.current);
        return { status: 200, body: { sessions: 2, trustedDevices: 1 } };
      },
    });
    render(<SecuritySection owner={false} userId="u-team" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Fermer toutes les autres' }));
    const group = screen.getByRole('group');
    expect(group.textContent).toContain('Les 2 autres sessions seront fermées');
    fireEvent.click(within(group).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Fermer toutes les autres' }));
    fireEvent.click(within(screen.getByRole('group')).getByRole('button', { name: 'Fermer les autres' }));
    expect(await screen.findByText('2 sessions fermées, et 1 appareil de confiance oublié.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Fermer toutes les autres' })).toBeNull();
    });
  });

  it('gives new backup codes against the password and a code, and says a refusal', async () => {
    const codes = Array.from({ length: 10 }, (_, index) => `code-${String(index).padStart(2, '0')}`);
    const calls = serve({
      'GET /auth/sessions': sessionsRoute(SESSIONS),
      'POST /auth/two-factor/generate-backup-codes': (body) =>
        typeof body === 'object' && body !== null && 'code' in body && body.code === '123456'
          ? { status: 200, body: { backupCodes: codes } }
          : { status: 401, body: apiError('reauthentication_unauthenticated') },
    });
    render(<SecuritySection owner={false} userId="u-team" />);

    fireEvent.click(screen.getByRole('button', { name: 'Créer de nouveaux codes' }));
    const password = screen.getByLabelText('Mot de passe');
    await waitFor(() => {
      expect(document.activeElement).toBe(password);
    });
    fireEvent.change(password, { target: { value: 'un mot de passe' } });
    const code = screen.getByLabelText('Code à 6 chiffres ou de secours');
    fireEvent.change(code, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer les codes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Mot de passe ou code incorrect.');
    expect(code).toHaveProperty('value', '');

    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer les codes' }));
    expect(await screen.findByText('code-00')).toBeTruthy();
    expect(screen.getByText('code-09')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { password: 'un mot de passe', code: '000000' },
      { password: 'un mot de passe', code: '123456' },
    ]);

    // Once put away, they are never shown again.
    fireEvent.click(screen.getByRole('button', { name: 'Je les ai mis en lieu sûr' }));
    expect(screen.queryByText('code-00')).toBeNull();
    expect(screen.getByRole('button', { name: 'Créer de nouveaux codes' })).toBeTruthy();
  });

  it('asks for the code before sending, and says too many attempts', async () => {
    const calls = serve({
      'GET /auth/sessions': sessionsRoute(SESSIONS),
      'POST /auth/two-factor/generate-backup-codes': () => ({
        status: 429,
        body: apiError('reauthentication_rate_limited'),
      }),
    });
    render(<SecuritySection owner={false} userId="u-team" />);

    fireEvent.click(screen.getByRole('button', { name: 'Créer de nouveaux codes' }));
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'un mot de passe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer les codes' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Code à 6 chiffres ou de secours'));
    });
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer les codes' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Trop d’essais. Attends quelques minutes avant de réessayer.',
    );
  });

  it('shows the owner each account’s second factor, and closes an account’s sessions after a confirmation', async () => {
    let accounts = ACCOUNTS;
    let confirmed = false;
    const calls = serve({
      'GET /auth/sessions': sessionsRoute(SESSIONS.slice(0, 1)),
      'GET /settings/security/accounts': () => ({ status: 200, body: { accounts } }),
      'POST /settings/security/accounts/u-team/close-sessions': () => {
        if (!confirmed) return { status: 403, body: apiError('reauthentication_forbidden') };
        accounts = accounts.map((account) =>
          account.userId === 'u-team' ? { ...account, sessions: 0 } : account,
        );
        return { status: 200, body: { sessions: 2, trustedDevices: 0 } };
      },
    });
    confirmIdentity.mockImplementation(() => {
      confirmed = true;
      return Promise.resolve('ok');
    });
    render(<SecuritySection owner userId="u-owner" />);

    const list = await screen.findByRole('list', { name: 'Comptes de l’agence' });
    const [owner, team] = within(list).getAllByRole('listitem');
    expect(owner?.textContent).toContain('Propriétaire');
    expect(owner?.textContent).toContain('Code à 6 chiffres actif');
    // His own sessions are closed above, one by one.
    expect(within(present(owner)).queryByRole('button')).toBeNull();
    expect(team?.textContent).toContain('Équipe');
    expect(team?.textContent).toContain('Code à 6 chiffres pas encore activé');
    expect(team?.textContent).toContain('2 sessions ouvertes · active il y a 30 min');

    fireEvent.click(screen.getByRole('button', { name: 'Fermer toutes les sessions de Noé' }));
    expect(
      await screen.findByText(
        'Pour fermer toutes les sessions de Noé, confirme ton mot de passe et ton code.',
      ),
    ).toBeTruthy();
    const prompt = within(present(team));
    fireEvent.change(prompt.getByLabelText('Mot de passe'), { target: { value: 'un mot de passe' } });
    fireEvent.change(prompt.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(prompt.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText('Noé : 2 sessions fermées.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Fermer toutes les sessions de Noé' })).toBeNull();
    });
    expect(confirmIdentity).toHaveBeenCalledWith('un mot de passe', '123456');
    expect(
      calls.filter((call) => call.path === '/settings/security/accounts/u-team/close-sessions'),
    ).toHaveLength(2);
  });
});
