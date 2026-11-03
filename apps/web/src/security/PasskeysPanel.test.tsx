// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  platformAuthenticatorIsAvailable: vi.fn(() => Promise.resolve(true)),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  ...browser,
}));
const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', () => ({
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

import { SecuritySection } from './SecuritySection';
import { dayText, passkeysText } from './view';

/** Invented keys and accounts: no real person, no real device. */
const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const PHONE_KEY = {
  id: 'pk-phone',
  device: 'Safari sur iPhone',
  keychain: 'iCloud Keychain',
  createdAt: '2026-10-28T10:00:00.000Z',
  lastUsedAt: minutesAgo(30),
};
const LAPTOP_KEY = {
  id: 'pk-laptop',
  device: 'Chrome sur Windows',
  keychain: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  lastUsedAt: null,
};
const OPTIONS = { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' };
const CREATION_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Impera' },
  user: { id: 'dXNlcg', name: 'lina@example.test', displayName: 'Lina' },
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
};
const GESTURE = { id: 'a2V5', rawId: 'a2V5', type: 'public-key', response: {} };
const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
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

const noSessions: Route = () => [200, { sessions: [] }];

beforeEach(() => {
  browser.startAuthentication.mockResolvedValue(GESTURE);
  browser.startRegistration.mockResolvedValue(GESTURE);
  confirmIdentity.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Clés d’accès in Sécurité (ADR 0053 § 5)', () => {
  it('counts keys in words', () => {
    expect(passkeysText(0)).toBe('Aucune clé d’accès');
    expect(passkeysText(1)).toBe('1 clé d’accès');
    expect(passkeysText(3)).toBe('3 clés d’accès');
    expect(dayText('2026-11-01T10:00:00.000Z')).toBe('1er nov. 2026');
    expect(dayText('2026-10-28T10:00:00.000Z')).toBe('28 oct. 2026');
  });

  it('says a refused gesture after a wrong password, not the password’s refusal', async () => {
    serve({
      'GET /auth/sessions': noSessions,
      'GET /auth/passkeys': () => [200, { passkeys: [PHONE_KEY, LAPTOP_KEY] }],
      'DELETE /auth/passkeys/pk-laptop': () => [403, apiError('reauthentication_forbidden')],
      'POST /auth/passkey/confirm-options': () => [200, OPTIONS],
      'POST /auth/passkey/confirm': () => [401, apiError('passkey_unauthenticated')],
    });
    confirmIdentity.mockResolvedValue('wrong_credentials');
    render(<SecuritySection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer la clé Chrome sur Windows' }));
    fireEvent.change(await screen.findByLabelText('Mot de passe'), { target: { value: 'faux' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Mot de passe ou code incorrect.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmer avec / }));
    expect(
      await screen.findByText(
        'Ce geste n’a pas été reconnu. Réessaie, ou donne ton mot de passe et ton code.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Mot de passe ou code incorrect.')).toBeNull();
  });

  it('lists one’s keys, and removes one after a gesture on another key, never itself', async () => {
    let keys = [PHONE_KEY, LAPTOP_KEY];
    let confirmed = false;
    const calls = serve({
      'GET /auth/sessions': noSessions,
      'GET /auth/passkeys': () => [200, { passkeys: keys }],
      'DELETE /auth/passkeys/pk-laptop': () => {
        if (!confirmed) return [403, apiError('reauthentication_forbidden')];
        keys = keys.filter((key) => key.id !== 'pk-laptop');
        return [204];
      },
      'POST /auth/passkey/confirm-options': () => [200, OPTIONS],
      'POST /auth/passkey/confirm': () => {
        confirmed = true;
        return [204];
      },
    });
    render(<SecuritySection />);

    const list = await screen.findByRole('list', { name: 'Clés d’accès' });
    const [phone, laptop] = within(list).getAllByRole('listitem');
    expect(phone?.textContent).toContain('Safari sur iPhone');
    expect(phone?.textContent).toContain('iCloud Keychain · ajoutée le 28 oct. 2026 · utilisée il');
    expect(laptop?.textContent).toContain('jamais utilisée');

    fireEvent.click(screen.getByRole('button', { name: 'Retirer la clé Chrome sur Windows' }));
    const gesture = await within(laptop ?? document.body).findByRole('button', { name: /^Confirmer avec / });
    fireEvent.click(gesture);
    expect(
      await screen.findByText('Clé retirée : Chrome sur Windows redemandera ton mot de passe et ton code.'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    });
    // The key being removed is left out of the gesture.
    expect(calls.find((call) => call.key === 'POST /auth/passkey/confirm-options')?.body).toEqual({
      excluding: 'pk-laptop',
    });
  });

  it('offers no gesture to remove the last key: the password and the code only', async () => {
    serve({
      'GET /auth/sessions': noSessions,
      'GET /auth/passkeys': () => [200, { passkeys: [PHONE_KEY] }],
      'DELETE /auth/passkeys/pk-phone': () => [403, apiError('reauthentication_forbidden')],
    });
    render(<SecuritySection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer la clé Safari sur iPhone' }));
    expect(await screen.findByLabelText('Mot de passe')).toBeTruthy();
    // The prompt read the keys: none other than this one, so no gesture is offered.
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/v1/auth/passkeys')).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: /^Confirmer avec / })).toBeNull();
  });

  it('adds a key after the password and the code, never after a gesture, with a fresh tap', async () => {
    let fresh = false;
    serve({
      'GET /auth/sessions': noSessions,
      'GET /auth/passkeys': () => [200, { passkeys: fresh ? [PHONE_KEY] : [] }],
      'GET /auth/passkey/generate-register-options': () =>
        fresh ? [200, CREATION_OPTIONS] : [403, apiError('reauthentication_forbidden')],
      'POST /auth/passkey/verify-registration': () => [200, PHONE_KEY],
    });
    confirmIdentity.mockImplementation(() => {
      fresh = true;
      return Promise.resolve('ok');
    });
    render(<SecuritySection />);
    expect(await screen.findByText(/^Aucune clé\. Ajoute/u)).toBeTruthy();
    const add = screen.getByRole('button', { name: /^Ajouter / });
    fireEvent.click(add);

    expect(await screen.findByText(/confirme d’abord ton mot de passe et ton code\.$/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Confirmer avec / })).toBeNull();
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'un mot de passe' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(/^C’est confirmé\. Touche « Ajouter /u)).toBeTruthy();
    expect(browser.startRegistration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter / }));
    expect(
      await screen.findByText(
        'Clé ajoutée : Safari sur iPhone. Tu te connecteras d’un geste sur cet appareil.',
      ),
    ).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Clés d’accès' })).toBeTruthy();
  });

  it('shows the owner « N clés » per account, and removes every key of one after a confirmation', async () => {
    let teamKeys = 2;
    let confirmed = false;
    serve({
      'GET /auth/sessions': noSessions,
      'GET /auth/passkeys': () => [200, { passkeys: [] }],
      'GET /settings/security/accounts': () => [
        200,
        {
          accounts: [
            {
              userId: 'u-owner',
              name: 'Lina',
              role: 'owner',
              secondFactor: true,
              sessions: 1,
              passkeys: 1,
              lastActiveAt: minutesAgo(0),
            },
            {
              userId: 'u-team',
              name: 'Noé',
              role: 'operator',
              secondFactor: true,
              sessions: 1,
              passkeys: teamKeys,
              lastActiveAt: minutesAgo(5),
            },
          ],
        },
      ],
      'POST /settings/security/accounts/u-team/remove-passkeys': () => {
        if (!confirmed) return [403, apiError('reauthentication_forbidden')];
        teamKeys = 0;
        return [200, { passkeys: 2 }];
      },
    });
    confirmIdentity.mockImplementation(() => {
      confirmed = true;
      return Promise.resolve('ok');
    });
    render(<SecuritySection ownerId="u-owner" />);

    const list = await screen.findByRole('list', { name: 'Comptes de l’agence' });
    const [owner, team] = within(list).getAllByRole('listitem');
    expect(owner?.textContent).toContain('1 clé d’accès');
    expect(team?.textContent).toContain('2 clés d’accès');
    // His own keys are removed above, one by one.
    expect(within(owner ?? document.body).queryByRole('button', { name: /clés d’accès/u })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer toutes les clés d’accès de Noé' }));
    const prompt = within(team ?? document.body);
    fireEvent.change(await prompt.findByLabelText('Mot de passe'), { target: { value: 'un mot de passe' } });
    fireEvent.change(prompt.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(prompt.getByRole('button', { name: 'Confirmer' }));
    expect(
      await screen.findByText('Noé : 2 clés d’accès retirées. Ses sessions restent ouvertes.'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(team?.textContent).toContain('Aucune clé d’accès');
    });
  });
});
