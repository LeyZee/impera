// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', () => ({
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

import { OwnersPanel } from './OwnersPanel';
import { effectiveText, remainingText } from './owners';

/** Invented accounts. */
const LINA = { userId: 'u-lina', name: 'Lina', you: true, secondFactor: true, passkeys: 0 };
const MARC = { userId: 'u-marc', name: 'Marc', you: false, secondFactor: true, passkeys: 2 };
const alone = {
  owners: [LINA],
  candidates: [
    { userId: 'u-marc', name: 'Marc', refusal: null },
    { userId: 'u-nora', name: 'Nora', refusal: 'second_factor_missing' },
  ],
  removal: null,
  noticeHours: 72,
};
const two = { owners: [LINA, MARC], candidates: [], removal: null, noticeHours: 72 };
const inHours = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();
const removalOf = (targetUserId: string, requestedBy: string) => ({
  id: '00000000-0000-4000-8000-000000000001',
  targetUserId,
  requestedBy,
  requestedAt: new Date().toISOString(),
  effectiveAt: inHours(72),
});
const apiError = (code: string, message = code): unknown => ({
  error: { code, message, details: {}, requestId: 'r1' },
});

type Route = (body: unknown) => readonly [number, unknown?];

function serve(routes: Record<string, Route>): { key: string; body: unknown }[] {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.replace(/^\/v1/u, '')}`;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ key, body });
      const [status, answer] = routes[key]?.(body) ?? [404];
      return Promise.resolve(new Response(answer === undefined ? null : JSON.stringify(answer), { status }));
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Propriétaires in Sécurité (ADR 0096)', () => {
  it('says what is left of the notice, and when it ends in the reader’s own zone', () => {
    const now = new Date('2026-11-20T10:00:00.000Z');
    expect(remainingText('2026-11-23T10:00:00.000Z', now)).toBe('dans\u00a072\u00a0h');
    expect(remainingText('2026-11-20T10:40:00.000Z', now)).toBe('dans\u00a040\u00a0min');
    expect(remainingText('2026-11-20T09:00:00.000Z', now)).toBe('d’un instant à l’autre');
    expect(effectiveText('2026-11-23T10:00:00.000Z')).toMatch(
      /^\p{L}+ 23 novembre à \d{2}\u00a0h\u00a0\d{2}$/u,
    );
  });

  it('makes a member the second owner, said back first, and names why another cannot be yet', async () => {
    const calls = serve({
      'GET /settings/security/owners': () => [200, alone],
      'POST /settings/security/owners': () => [200, two],
    });
    render(<OwnersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un second propriétaire' }));
    const members = screen.getByRole('list', { name: 'Membres de l’équipe' });
    expect(
      within(members).getByText('Doit d’abord se connecter et activer son code à 6 chiffres'),
    ).toBeTruthy();
    expect(within(members).queryByRole('button', { name: 'Rendre Nora propriétaire' })).toBeNull();

    // Nothing is sent before the gesture is said back and confirmed.
    fireEvent.click(within(members).getByRole('button', { name: 'Rendre Marc propriétaire' }));
    expect(calls.map((call) => call.key)).toEqual(['GET /settings/security/owners']);
    const confirm = screen.getByRole('group', { name: 'Confirmer le second propriétaire' });
    expect(confirm.textContent).toContain('qu’après 72 h de préavis');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Rendre Marc propriétaire' }));

    await screen.findByText(/Marc est maintenant propriétaire/u);
    expect(calls.at(-1)).toEqual({ key: 'POST /settings/security/owners', body: { userId: 'u-marc' } });
    const owners = screen.getByRole('list', { name: 'Propriétaires' });
    expect(within(owners).getAllByRole('listitem')).toHaveLength(2);
    // Two owners: nothing more to add.
    expect(screen.queryByRole('button', { name: 'Ajouter un second propriétaire' })).toBeNull();
  });

  it('asks for the password and the code when they are not recent, then runs the gesture again', async () => {
    let confirmed = false;
    const calls = serve({
      'GET /settings/security/owners': () => [200, two],
      'POST /settings/security/owners/u-marc/removal': () =>
        confirmed
          ? [200, { ...two, removal: removalOf('u-marc', 'u-lina') }]
          : [403, apiError('reauthentication_forbidden')],
    });
    confirmIdentity.mockImplementation(() => {
      confirmed = true;
      return Promise.resolve('ok');
    });
    render(<OwnersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Demander le retrait de Marc' }));
    const confirm = screen.getByRole('group', { name: 'Confirmer la demande de retrait' });
    expect(confirm.textContent).toContain('dans 72 h');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Demander le retrait' }));

    await screen.findByText('Pour demander le retrait de Marc, confirme ton mot de passe et ton code.');
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse' } });
    fireEvent.change(screen.getByLabelText(/Code/u), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    await screen.findByText(/Retrait demandé\. Marc est prévenu/u);
    expect(calls.filter((call) => call.key === 'POST /settings/security/owners/u-marc/removal')).toHaveLength(
      2,
    );
    // The one who asked reads when it ends, and has nothing to cancel.
    const waiting = screen.getByRole('group', { name: 'Retrait en attente' });
    expect(waiting.textContent).toContain('Tu as demandé le retrait de Marc');
    expect(within(waiting).queryByRole('button', { name: 'Annuler le retrait' })).toBeNull();
    // Who asked cannot take it back, and reads so; the owner it is about is marked in the list.
    expect(waiting.textContent).toContain('tu ne peux pas revenir sur ta demande');
    expect(screen.getByRole('list', { name: 'Propriétaires' }).textContent).toContain('retrait demandé');
    expect(screen.queryByRole('button', { name: 'Demander le retrait de Marc' })).toBeNull();
  });

  it('lets the owner a removal is about cancel it, and no one else', async () => {
    const calls = serve({
      'GET /settings/security/owners': () => [200, { ...two, removal: removalOf('u-lina', 'u-marc') }],
      'DELETE /settings/security/owners/removal': () => [200, two],
    });
    render(<OwnersPanel />);
    const waiting = await screen.findByRole('group', { name: 'Retrait en attente' });
    expect(waiting.textContent).toContain('Marc a demandé ton retrait');
    fireEvent.click(within(waiting).getByRole('button', { name: 'Annuler le retrait' }));
    await screen.findByText('Retrait annulé : tu restes propriétaire.');
    expect(calls.at(-1)?.key).toBe('DELETE /settings/security/owners/removal');
    expect(screen.queryByRole('group', { name: 'Retrait en attente' })).toBeNull();
  });

  it('says the server’s own sentence when the rule refuses, and reads the state again', async () => {
    const calls = serve({
      'GET /settings/security/owners': () => [200, alone],
      'POST /settings/security/owners': () => [
        409,
        apiError('owner_conflict', 'Il y a déjà 2 propriétaires : il n’y en a jamais plus'),
      ],
    });
    render(<OwnersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un second propriétaire' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rendre Marc propriétaire' }));
    const confirm = screen.getByRole('group', { name: 'Confirmer le second propriétaire' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Rendre Marc propriétaire' }));
    await screen.findByText('Il y a déjà 2 propriétaires : il n’y en a jamais plus');
    await waitFor(() => {
      expect(calls.filter((call) => call.key === 'GET /settings/security/owners')).toHaveLength(2);
    });
  });
});
