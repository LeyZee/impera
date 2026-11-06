// @vitest-environment jsdom
import {
  REAUTHENTICATION_ERROR_CODE,
  TeamMemberSchema,
  type SalesFeedOverview,
  type SalesFeedStatus,
  type TeamMember,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SalesFeedSection } from './SalesFeedSection';

import { choose, openList } from '@/test/select';

const ACCOUNT_LUNE = '00000000-0000-4000-8000-00000000000a';
const ACCOUNT_SOLEIL = '00000000-0000-4000-8000-00000000000b';
const MEMBER_ANA = '00000000-0000-4000-8000-0000000000a1';

function status(patch: Partial<SalesFeedStatus> = {}): SalesFeedStatus {
  return {
    platform: 'reveal',
    state: 'connected',
    capabilities: ['sales', 'stats'],
    verifiedAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    lastErrorKind: null,
    message: 'Les ventes et les remboursements de Reveal remontent chaque minute.',
    quarantined: 0,
    webhook: null,
    ...patch,
  };
}

function overview(patch: Partial<SalesFeedOverview> = {}): SalesFeedOverview {
  return {
    status: status(),
    models: [
      {
        platformModelId: 'm1',
        handle: 'lune',
        displayName: 'Lune',
        platformAccountId: ACCOUNT_LUNE,
        linkedBy: { kind: 'auto' },
        quarantined: 0,
      },
      {
        platformModelId: 'm2',
        handle: 'soleil',
        displayName: 'Soleil',
        platformAccountId: null,
        linkedBy: null,
        quarantined: 3,
      },
    ],
    accounts: [
      { platformAccountId: ACCOUNT_LUNE, handle: 'lune', creatorDisplayName: 'Lune', linkedTo: 'm1' },
      { platformAccountId: ACCOUNT_SOLEIL, handle: 'soleil', creatorDisplayName: 'Soleil', linkedTo: null },
    ],
    chatters: [
      {
        platformChatterId: 'c1',
        firstName: 'Ana',
        lastName: 'Test',
        isBot: false,
        isExternal: false,
        removedAt: null,
        platformModelIds: ['m1'],
        link: null,
      },
    ],
    listError: null,
    candidates: [],
    dismissed: [],
    ...patch,
  };
}

const ANA: TeamMember = TeamMemberSchema.parse({
  id: MEMBER_ANA,
  userId: '00000000-0000-4000-8000-0000000000b1',
  email: 'ana@example.test',
  firstName: 'Ana',
  lastName: 'Test',
  displayName: 'Ana T.',
  teamRole: 'chatter',
  status: 'active',
  country: 'BJ',
  timeZone: 'Africa/Porto-Novo',
  color: null,
  joinedOn: '2026-01-01',
  creatorIds: [],
  commission: null,
  invitationPending: false,
  invitationExpiresAt: null,
});

const apiError = (code: string, message: string): object => ({
  error: { code, message, details: {}, requestId: 'req-1' },
});

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };

/** A fake server by « METHOD path »; anything else is a 404 the test would see. */
function serve(
  routes: Record<string, Handler>,
): Mock<(url: string, init?: RequestInit) => Promise<Response>> {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${url}`];
    const { status: code, body } = handler === undefined ? { status: 404, body: null } : handler(init);
    return Promise.resolve(Response.json(body, { status: code }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const ok =
  (body: unknown): Handler =>
  () => ({ status: 200, body });

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SalesFeedSection />
    </QueryClientProvider>,
  );
}

const BASE = '/v1/settings/sales-feeds';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Ventes', () => {
  it('offers to connect the key, and nothing else, while there is none', async () => {
    const none = status({ state: 'not_connected', capabilities: [], lastReadAt: null, message: 'Sans clé.' });
    serve({
      [`GET ${BASE}`]: ok({ feeds: [none] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: none, models: [], accounts: [], chatters: [] })),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    expect(screen.getByLabelText('Clé de l’API CRM de Reveal')).toBeTruthy();
    expect(screen.queryByText('Réception instantanée')).toBeNull();
    expect(screen.queryByText('Modèles Reveal')).toBeNull();
  });

  it('masks the key, and shows it on « Afficher » (recette 05/11, PRO-29)', async () => {
    const none = status({ state: 'not_connected', capabilities: [], lastReadAt: null, message: 'Sans clé.' });
    serve({
      [`GET ${BASE}`]: ok({ feeds: [none] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: none, models: [], accounts: [], chatters: [] })),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    const field = screen.getByLabelText('Clé de l’API CRM de Reveal');
    expect(field.className).toContain('sv-key__secret');
    expect(field.getAttribute('data-shown')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher' }));
    expect(field.getAttribute('data-shown')).toBe('true');
    expect(screen.getByRole('button', { name: 'Masquer' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says the platform’s refusal under the field, and never keeps a refused key', async () => {
    const none = status({ state: 'not_connected', capabilities: [], lastReadAt: null, message: 'Sans clé.' });
    const fetch = serve({
      [`GET ${BASE}`]: ok({ feeds: [none] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: none, models: [], accounts: [], chatters: [] })),
      [`PUT ${BASE}/reveal/key`]: () => ({
        status: 422,
        body: { kind: 'unauthorized', message: 'Reveal refuse cette clé : elle est inconnue.' },
      }),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter la clé' }));
    const field = screen.getByLabelText('Clé de l’API CRM de Reveal');
    fireEvent.paste(field, { clipboardData: { getData: () => ' rvl_test_key \n' } });
    expect(await screen.findByText('Reveal refuse cette clé : elle est inconnue.')).toBeTruthy();
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[1]?.body).toBe(JSON.stringify({ key: 'rvl_test_key' }));
  });

  it('never warns about a quiet webhook: no sale for hours only means no sale', async () => {
    const quiet = status({
      webhook: {
        createdAt: '2026-10-30T08:00:00.000Z',
        lastDeliveryAt: '2026-10-31T08:00:00.000Z',
        lastRejectedAt: null,
      },
    });
    serve({
      [`GET ${BASE}`]: ok({ feeds: [quiet] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: quiet })),
    });
    renderSection();
    expect(await screen.findByText(/^Active depuis le 30 oct\./u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Réinscrire' })).toBeNull();
    expect(screen.queryByText(/refusé/u)).toBeNull();
  });

  it('asks to register the webhook again after a refused delivery, through the password and the code', async () => {
    const rejected = status({
      webhook: {
        createdAt: '2026-10-30T08:00:00.000Z',
        lastDeliveryAt: null,
        lastRejectedAt: '2026-11-02T21:30:00.000Z',
      },
    });
    let asked = 0;
    const fetch = serve({
      [`GET ${BASE}`]: ok({ feeds: [rejected] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: rejected })),
      [`PUT ${BASE}/reveal/webhook`]: () => {
        asked += 1;
        return { status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE, 'Confirme') };
      },
    });
    renderSection();
    expect(await screen.findByText(/Réinscris le webhook/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réinscrire' }));
    expect(
      await screen.findByText('Pour inscrire le webhook, confirme ton mot de passe et ton code.'),
    ).toBeTruthy();
    expect(asked).toBe(1);
    // A bare PUT: the server takes no body there, and Fastify refuses an empty body announced as JSON.
    const put = fetch.mock.calls.find(([url]) => url === `${BASE}/reveal/webhook`);
    expect(put?.[1]).toEqual({ credentials: 'include', method: 'PUT' });
  });

  it('offers the webhook only with a key that reads: none while reading stopped', async () => {
    const stopped = status({ state: 'needs_reconnect', lastErrorKind: 'unauthorized', message: 'Arrêtée.' });
    serve({
      [`GET ${BASE}`]: ok({ feeds: [stopped] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: stopped })),
    });
    renderSection();
    expect(await screen.findByRole('button', { name: 'Reconnecter la clé' })).toBeTruthy();
    expect(screen.queryByText('Réception instantanée')).toBeNull();
  });

  it('says that removing the key stops the instant reception too, before removing it', async () => {
    serve({
      [`GET ${BASE}`]: ok({ feeds: [status()] }),
      [`GET ${BASE}/reveal`]: ok(overview()),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }));
    expect(screen.getByText(/la réception instantanée s’arrête aussi/u)).toBeTruthy();
    expect(screen.getByText(/Les ventes déjà enregistrées restent/u)).toBeTruthy();
  });

  it('shows an auto link to check, the quarantined sales, and an account taken elsewhere as not choosable', async () => {
    serve({
      [`GET ${BASE}`]: ok({ feeds: [status({ quarantined: 3 })] }),
      [`GET ${BASE}/reveal`]: ok(overview({ status: status({ quarantined: 3 }) })),
    });
    renderSection();
    expect(await screen.findByText('Relié par pseudo identique')).toBeTruthy();
    expect(screen.getByText(/^3 ventes attendent un modèle relié/u)).toBeTruthy();
    expect(
      screen.getByText('3 ventes en attente : relier ce modèle les fait entrer au registre.'),
    ).toBeTruthy();
    const soleil = screen.getByRole('combobox', { name: 'Compte de Soleil (@soleil)' });
    const taken = within(openList(soleil)).getByRole('option', { name: '@lune · Lune relié à @lune' });
    expect(taken.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('select')).toBeNull();
  });

  it('links a model and lands the server’s answer; a refusal is said under its row', async () => {
    let linked = false;
    const fetch = serve({
      [`GET ${BASE}`]: ok({ feeds: [status()] }),
      [`GET ${BASE}/reveal`]: ok(overview()),
      [`PUT ${BASE}/reveal/models/m2`]: () => {
        if (linked)
          return { status: 409, body: apiError('sales_feed_model_conflict', 'Ce compte est déjà lié') };
        linked = true;
        const after = overview();
        return {
          status: 200,
          body: {
            ...after,
            models: after.models.map((m) =>
              m.platformModelId === 'm2'
                ? {
                    ...m,
                    platformAccountId: ACCOUNT_SOLEIL,
                    linkedBy: { kind: 'member', userId: 'u1' },
                    quarantined: 0,
                  }
                : m,
            ),
          },
        };
      },
    });
    renderSection();
    const soleil = await screen.findByRole('combobox', { name: 'Compte de Soleil (@soleil)' });
    choose(soleil, /^@soleil/u);
    await waitFor(() => {
      expect(screen.queryByText(/ventes en attente/u)).toBeNull();
    });
    const put = fetch.mock.calls.find(([url]) => url === `${BASE}/reveal/models/m2`);
    expect(put?.[1]?.body).toBe(JSON.stringify({ platformAccountId: ACCOUNT_SOLEIL }));

    choose(screen.getByRole('combobox', { name: 'Compte de Soleil (@soleil)' }), 'Aucun compte');
    expect(
      await screen.findByText('Soleil (@soleil) n’a pas été relié. Ce compte est déjà lié.'),
    ).toBeTruthy();
  });

  it('confirms a link the handle posed by posing the same account again', async () => {
    const fetch = serve({
      [`GET ${BASE}`]: ok({ feeds: [status()] }),
      [`GET ${BASE}/reveal`]: ok(overview()),
      [`PUT ${BASE}/reveal/models/m1`]: () => {
        const after = overview();
        return {
          status: 200,
          body: {
            ...after,
            models: after.models.map((m) =>
              m.platformModelId === 'm1' ? { ...m, linkedBy: { kind: 'member', userId: 'u1' } } : m,
            ),
          },
        };
      },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer le compte de Lune (@lune)' }));
    await waitFor(() => {
      expect(screen.queryByText('Relié par pseudo identique')).toBeNull();
    });
    const put = fetch.mock.calls.find(([url]) => url === `${BASE}/reveal/models/m1`);
    expect(put?.[1]?.body).toBe(JSON.stringify({ platformAccountId: ACCOUNT_LUNE }));
  });

  it('links a platform team member to a team member, by the team’s list', async () => {
    const fetch = serve({
      [`GET ${BASE}`]: ok({ feeds: [status()] }),
      [`GET ${BASE}/reveal`]: ok(overview()),
      'GET /v1/team/members': ok({ members: [ANA] }),
      [`PUT ${BASE}/reveal/chatters/c1`]: ok(overview()),
    });
    renderSection();
    const field = await screen.findByRole('combobox', { name: 'Lien de Ana Test' });
    await waitFor(() => {
      expect(within(openList(field)).getByRole('option', { name: 'Ana T.' })).toBeTruthy();
    });
    choose(field, 'Ana T.');
    await waitFor(() => {
      expect(fetch.mock.calls.some(([url]) => url === `${BASE}/reveal/chatters/c1`)).toBe(true);
    });
    const put = fetch.mock.calls.find(([url]) => url === `${BASE}/reveal/chatters/c1`);
    expect(put?.[1]?.body).toBe(JSON.stringify({ kind: 'member', memberId: MEMBER_ANA }));
  });

  it('tells a member who is not the owner that the page is the owner’s', async () => {
    serve({ [`GET ${BASE}`]: () => ({ status: 403, body: apiError('role_forbidden', 'Non') }) });
    renderSection();
    expect(await screen.findByText('Seul le propriétaire règle la lecture des ventes')).toBeTruthy();
  });
});
