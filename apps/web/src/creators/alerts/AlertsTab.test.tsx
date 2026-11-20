// @vitest-environment jsdom
import {
  CREATOR_ALERT_CODES,
  CREATOR_ALERT_DEFAULTS,
  CREATOR_ALERT_FAMILY,
  SetCreatorAlertBodySchema,
  isClosedToChatters,
  isCreatorAlertLocked,
  type CreatorAlertLine,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlertsTab } from './AlertsTab';

/* An invented creator: no real person. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';

const lines = (): CreatorAlertLine[] =>
  CREATOR_ALERT_CODES.map((code) => ({
    code,
    family: CREATOR_ALERT_FAMILY[code],
    locked: isCreatorAlertLocked(code),
    chattersClosed: isClosedToChatters(code),
    routes: CREATOR_ALERT_DEFAULTS[code],
    isDefault: true,
  }));

interface Write {
  readonly path: string;
  readonly body: unknown;
}

function serve(alerts: CreatorAlertLine[], answer?: (write: Write) => Response): Write[] {
  const writes: Write[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (init?.method === undefined || init.method === 'GET')
        return Promise.resolve(new Response(JSON.stringify({ creatorId: CREATOR, alerts })));
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
      const write = { path, body };
      writes.push(write);
      if (answer !== undefined) return Promise.resolve(answer(write));
      const code = path.split('/').at(-1);
      const line = alerts.find((each) => each.code === code);
      const { routes } = SetCreatorAlertBodySchema.parse(body);
      return Promise.resolve(new Response(JSON.stringify({ ...line, routes, isDefault: false })));
    }),
  );
  return writes;
}

function renderTab(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AlertsTab creatorId={CREATOR} creatorName="Nora" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const lineOf = async (title: string): Promise<HTMLElement> => {
  const found = await screen.findByText(title, { selector: '.ca-line__title' });
  const item = found.closest('li');
  if (item === null) throw new Error(`no line for ${title}`);
  return item;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Alertes (ADR 0150)', () => {
  it('shows her alerts by family, the three roles of each, and the safety relay with words, no control', async () => {
    serve(lines());
    renderTab();
    for (const family of ['Sécurité', 'Ventes', 'Conversation', 'Pilotage', 'Système']) {
      expect(await screen.findByRole('heading', { name: family })).toBeTruthy();
    }
    const safety = await lineOf('Relais de sécurité');
    expect(within(safety).queryAllByRole('radiogroup')).toHaveLength(0);
    expect(within(safety).getByText('Reçoit toujours')).toBeTruthy();
    expect(within(safety).getByText(/même la nuit/u)).toBeTruthy();

    const sale = await lineOf('Vente');
    const groups = within(sale).getAllByRole('radiogroup');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Vente, Propriétaire',
      'Vente, Manager',
      'Vente, Chatteur en shift',
    ]);
    expect(
      within(groups[1] ?? sale)
        .getByRole('radio', { name: 'Sourdine' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shuts « Compte sans personne » to the chatters, the owner and the manager still to choose (ADR 0094 § 3)', async () => {
    const writes = serve(lines());
    renderTab();
    const uncovered = await lineOf('Compte sans personne');
    const groups = within(uncovered).getAllByRole('radiogroup');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Compte sans personne, Propriétaire',
      'Compte sans personne, Manager',
    ]);
    const closed = uncovered.querySelector('.ca-role__closed');
    expect(closed?.textContent).toBe('Chatteur en shift : Jamais');
    expect(closed?.getAttribute('tabindex')).toBeNull();
    expect(within(uncovered).getByText(/Jamais envoyée à un chatteur/u)).toBeTruthy();
    fireEvent.click(within(groups[1] ?? uncovered).getByRole('radio', { name: 'Sourdine' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toEqual({
      path: `/v1/creators/${CREATOR}/alerts/uncovered_account`,
      body: { routes: { owner: 'deliver', manager: 'muted', chatter_on_shift: 'off' } },
    });
  });

  it('saves a role’s choice at once, the three roles whole', async () => {
    const writes = serve(lines());
    renderTab();
    const sale = await lineOf('Vente');
    const manager = within(sale).getByRole('radiogroup', { name: 'Vente, Manager' });
    fireEvent.click(within(manager).getByRole('radio', { name: 'Reçoit' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toEqual({
      path: `/v1/creators/${CREATOR}/alerts/sale`,
      body: { routes: { owner: 'deliver', manager: 'deliver', chatter_on_shift: 'muted' } },
    });
    expect(await screen.findByText('Vente : enregistré.')).toBeTruthy();
    expect(within(manager).getByRole('radio', { name: 'Reçoit' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves with the arrow keys, one stop per group', async () => {
    const writes = serve(lines());
    renderTab();
    const sale = await lineOf('Vente');
    const owner = within(sale).getByRole('radiogroup', { name: 'Vente, Propriétaire' });
    const tabbable = within(owner)
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    fireEvent.keyDown(owner, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(writes[0]?.body).toEqual({
        routes: { owner: 'muted', manager: 'muted', chatter_on_shift: 'muted' },
      });
    });
  });

  it('says in amber that nobody receives an alert whose three roles are on Rien', async () => {
    const quiet = lines().map((line) =>
      line.code === 'session_expired'
        ? { ...line, routes: { owner: 'off', manager: 'off', chatter_on_shift: 'off' } as const }
        : line,
    );
    serve(quiet);
    renderTab();
    const session = await lineOf('Session expirée');
    expect(within(session).getByText('Personne ne reçoit cette alerte.')).toBeTruthy();
    expect(within(await lineOf('Vente')).queryByText('Personne ne reçoit cette alerte.')).toBeNull();
  });

  it('puts the line back and says why when the server refuses', async () => {
    serve(lines(), () => new Response('{}', { status: 503 }));
    renderTab();
    const sale = await lineOf('Vente');
    const manager = within(sale).getByRole('radiogroup', { name: 'Vente, Manager' });
    fireEvent.click(within(manager).getByRole('radio', { name: 'Rien' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Le serveur ne répond pas. Réessaie dans un instant.');
    expect(within(manager).getByRole('radio', { name: 'Sourdine' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
