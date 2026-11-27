// @vitest-environment jsdom
import { NotificationPreferencesSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsPage } from './NotificationsPage';
import { pushState, readServerKey, turnOffPush, turnOnPush, type PushState } from './push';

vi.mock('./push', () => ({
  PUSH_KEY_URL: '/v1/notifications/push-key',
  pushState: vi.fn(),
  readServerKey: vi.fn(),
  turnOnPush: vi.fn(),
  turnOffPush: vi.fn(),
}));

const SERVER_KEY = new Uint8Array(new ArrayBuffer(65)).fill(4);

const ALL_ON = { agency_request: true, week_to_validate: true, earnings: true, lives: true };
const DEFAULTS = { quietHours: { startMinute: 1320, endMinute: 480 }, dailyCap: 6 };

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

const EMPTY_INBOX = { items: [] };

/** The server: preferences kept as written, the test send answered with `testStatus`, the inbox as given. */
function serve(testStatus = 200, inbox: unknown = EMPTY_INBOX, kindsPutStatus = 200): Call[] {
  const calls: Call[] = [];
  let saved: unknown = DEFAULTS;
  let kinds: unknown = ALL_ON;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      if (url === '/v1/notifications/preferences') {
        if (method === 'PUT') saved = body;
        return Promise.resolve(new Response(JSON.stringify(saved), { status: 200 }));
      }
      if (url === '/v1/notifications/kinds') {
        if (method === 'PUT') {
          if (kindsPutStatus !== 200) return Promise.resolve(new Response(null, { status: kindsPutStatus }));
          kinds = body;
        }
        return Promise.resolve(new Response(JSON.stringify(kinds), { status: 200 }));
      }
      if (url === '/v1/notifications/inbox') {
        return Promise.resolve(new Response(JSON.stringify(inbox), { status: 200 }));
      }
      if (url === '/v1/notifications/test') {
        return Promise.resolve(
          new Response(testStatus === 200 ? JSON.stringify({ devices: 1, sent: 1 }) : null, {
            status: testStatus,
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    }),
  );
  return calls;
}

function renderPage(creator = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <NotificationsPage creator={creator} />,
  });
  const install = createRoute({
    getParentRoute: () => rootRoute,
    path: '/aide/installer',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, install]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const deviceIs = (...states: PushState[]): void => {
  const mock = vi.mocked(pushState);
  mock.mockReset();
  for (const state of states.slice(0, -1)) mock.mockResolvedValueOnce(state);
  mock.mockResolvedValue(states.at(-1) ?? 'off');
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(turnOnPush).mockReset();
  vi.mocked(readServerKey).mockReset().mockResolvedValue(SERVER_KEY);
  vi.mocked(turnOffPush).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Notifications, this device', () => {
  it('turns notifications on from a touch, then offers a test and a way to stop', async () => {
    serve();
    deviceIs('off', 'on');
    vi.mocked(turnOnPush).mockResolvedValue('on');
    renderPage();
    const turnOn = await screen.findByRole('button', { name: 'Activer les notifications' });
    await waitFor(() => {
      expect(turnOn).toHaveProperty('disabled', false);
    });
    fireEvent.click(turnOn);
    expect(turnOnPush).toHaveBeenCalledExactlyOnceWith(SERVER_KEY);
    expect(await screen.findByRole('button', { name: 'Envoyer un test' })).toBeTruthy();
    expect(screen.getByText('Cet appareil reçoit les notifications d’Impera.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activer les notifications' })).toBeNull();
  });

  it('says why when the browser refused, and stays off', async () => {
    serve();
    deviceIs('off', 'denied');
    vi.mocked(turnOnPush).mockResolvedValue('denied');
    renderPage();
    const turnOn = await screen.findByRole('button', { name: 'Activer les notifications' });
    await waitFor(() => {
      expect(turnOn).toHaveProperty('disabled', false);
    });
    fireEvent.click(turnOn);
    expect(await screen.findByText('Refusé : rien ne sonnera sur cet appareil.')).toBeTruthy();
    expect(screen.getByText(/réglages du téléphone ou du navigateur/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activer les notifications' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Envoyer un test' })).toBeNull();
  });

  it('offers « Activer » only once the server’s key is read, so the question leaves from the touch itself', async () => {
    serve();
    deviceIs('off');
    vi.mocked(readServerKey).mockReset().mockRejectedValue(new Error('push_key_503'));
    renderPage();
    expect(
      await screen.findByText(
        'Impera ne répond pas pour l’instant : rouvre cette page dans un instant pour activer.',
      ),
    ).toBeTruthy();
    const turnOn = screen.getByRole('button', { name: 'Activer les notifications' });
    expect(turnOn).toHaveProperty('disabled', true);
    fireEvent.click(turnOn);
    expect(turnOnPush).not.toHaveBeenCalled();
  });

  it('sends a test, and says when the account has no device on the server', async () => {
    const calls = serve(404);
    deviceIs('on');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer un test' }));
    expect(await screen.findByText('Aucun appareil abonné sur ce compte : active d’abord.')).toBeTruthy();
    expect(calls).toContainEqual({ method: 'POST', url: '/v1/notifications/test', body: undefined });
  });

  it('turns this device off', async () => {
    serve();
    deviceIs('on', 'off');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Couper sur cet appareil' }));
    await screen.findByRole('button', { name: 'Activer les notifications' });
    expect(turnOffPush).toHaveBeenCalledOnce();
  });

  it('sends an iPhone in Safari to the install guide first', async () => {
    serve();
    deviceIs('needs_install');
    renderPage();
    const link = await screen.findByRole('link', { name: 'Installer Impera' });
    expect(link.getAttribute('href')).toBe('/aide/installer');
  });
});

describe('Notifications, when it rings', () => {
  const save = () => screen.getByRole('button', { name: 'Enregistrer' });

  it('shows the defaults, saves new quiet hours and cap, and keeps them', async () => {
    const calls = serve();
    deviceIs('unsupported');
    renderPage();
    const start = await screen.findByLabelText('Début des heures calmes');
    // Written as the line under them writes them, « 22 h », not « 22:00 » (CHA-26).
    expect(start).toHaveProperty('value', '22\u00a0h');
    expect(screen.getByLabelText('Fin des heures calmes')).toHaveProperty('value', '8\u00a0h');
    expect(save()).toHaveProperty('disabled', true);

    fireEvent.change(start, { target: { value: '23:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Une de moins' }));
    fireEvent.click(save());
    await screen.findByText('Enregistré.');
    const sent = calls.find((call) => call.method === 'PUT');
    expect(NotificationPreferencesSchema.parse(sent?.body)).toEqual({
      quietHours: { startMinute: 1410, endMinute: 480 },
      dailyCap: 5,
    });
    await waitFor(() => {
      expect(save()).toHaveProperty('disabled', true);
    });
  });

  it('lets the creator turn a sort off for herself, saved at once (ADR 0150 § 16 ter)', async () => {
    const calls = serve();
    deviceIs('unsupported');
    renderPage(true);
    const gains = await screen.findByRole('switch', { name: /^Tes gains/u });
    expect(gains).toHaveProperty('checked', true);
    expect(screen.getByText('Toi seule vois ces choix ; l’agence ne les voit pas.')).toBeTruthy();
    fireEvent.click(gains);
    expect(await screen.findByText('Tes gains : coupés.')).toBeTruthy();
    expect(
      calls.find((call) => call.method === 'PUT' && call.url === '/v1/notifications/kinds')?.body,
    ).toEqual({
      ...ALL_ON,
      earnings: false,
    });
    expect(screen.getByRole('switch', { name: /^Tes gains/u })).toHaveProperty('checked', false);
  });

  it.each([
    [/^Demandes de l’agence/u, 'Demandes de l’agence : coupées.', 'Demandes de l’agence : activées.'],
    [/^Ta semaine à valider/u, 'Ta semaine à valider : coupée.', 'Ta semaine à valider : activée.'],
    [/^Tes gains/u, 'Tes gains : coupés.', 'Tes gains : activés.'],
    [/^Tes lives/u, 'Tes lives : coupés.', 'Tes lives : activés.'],
  ])('says each sort off and back on in its own agreement (%s)', async (name, off, on) => {
    serve();
    deviceIs('unsupported');
    renderPage(true);
    fireEvent.click(await screen.findByRole('switch', { name }));
    expect(await screen.findByText(off)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name }));
    expect(await screen.findByText(on)).toBeTruthy();
  });

  it('puts a sort back and says so when the save is refused', async () => {
    serve(200, EMPTY_INBOX, 503);
    deviceIs('unsupported');
    renderPage(true);
    fireEvent.click(await screen.findByRole('switch', { name: /^Tes lives/u }));
    expect((await screen.findByText('Pas enregistré. Réessaie dans un instant.')).getAttribute('role')).toBe(
      'alert',
    );
    expect(screen.getByRole('switch', { name: /^Tes lives/u })).toHaveProperty('checked', true);
  });

  it('shows no sorts to the team, whose alerts are set by the owner', async () => {
    serve();
    deviceIs('unsupported');
    renderPage();
    expect(await screen.findByLabelText('Début des heures calmes')).toBeTruthy();
    expect(screen.queryByText('Ce que tu reçois')).toBeNull();
  });

  it('never speaks of a shift to the creator, who has none (CREA-12)', async () => {
    serve();
    deviceIs('unsupported');
    renderPage(true);
    expect(await screen.findByText('Rien ne sonne. Un récapitulatif t’attend à la fin.')).toBeTruthy();
    expect(screen.getByText('Rappels et routine. Tes ventes ne comptent pas.')).toBeTruthy();
    expect(screen.queryByText(/shift/u)).toBeNull();
  });

  it('switches quiet hours off as start equal to end', async () => {
    const calls = serve();
    deviceIs('off');
    renderPage();
    fireEvent.click(await screen.findByRole('switch'));
    expect(screen.queryByLabelText('Début des heures calmes')).toBeNull();
    expect(screen.getByText('Sans heures calmes, tout sonne à toute heure.')).toBeTruthy();
    fireEvent.click(save());
    await screen.findByText('Enregistré.');
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      quietHours: { startMinute: 0, endMinute: 0 },
      dailyCap: 6,
    });
  });

  it('keeps quiet hours on while an hour typed equals the other, and says the range is empty (PRO-01)', async () => {
    serve();
    deviceIs('off');
    renderPage();
    const start = await screen.findByLabelText('Début des heures calmes');
    fireEvent.change(start, { target: { value: '8' } });
    expect(screen.getByRole('switch')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Début des heures calmes')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      'Une plage doit commencer et finir à des heures différentes.',
    );
    expect(save()).toHaveProperty('disabled', true);
    fireEvent.change(start, { target: { value: '08:30' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save()).toHaveProperty('disabled', false);
  });

  it('never saves an hour that is not one', async () => {
    serve();
    deviceIs('off');
    renderPage();
    fireEvent.change(await screen.findByLabelText('Fin des heures calmes'), { target: { value: '7h7h' } });
    expect(save()).toHaveProperty('disabled', true);
    // Said, never only a grey « Enregistrer » (MOD-07).
    expect(screen.getByRole('alert').textContent).toBe('Écris une heure, comme 23 h ou 23:30.');
  });
});

// Recette 11/11 (GES-15): unreadable settings were a grey line with no way out but a reload.
describe('Notifications, settings that cannot be read', () => {
  it('says the server is silent, in amber, and reads them again on « Réessayer »', async () => {
    let answers = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/v1/notifications/inbox') {
          return Promise.resolve(new Response(JSON.stringify(EMPTY_INBOX), { status: 200 }));
        }
        if (url !== '/v1/notifications/preferences') {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        answers += 1;
        return Promise.resolve(
          answers === 1
            ? new Response(null, { status: 503 })
            : new Response(JSON.stringify(DEFAULTS), { status: 200 }),
        );
      }),
    );
    deviceIs('off');
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    // One message for one silent server (ETA-05): this device's card says nothing of it.
    expect(screen.queryByText(/rouvre cette page/u)).toBeNull();
    expect(screen.queryByText(/illisibles/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByLabelText('Début des heures calmes')).toBeTruthy();
    expect(answers).toBe(2);
  });
});

// Trou 9 du 21/11: the recap said « 3 notifications t’attendent dans Impera » and none was to be found.
describe('Notifications, the ones of the last days', () => {
  const at = (iso: string) => new Date(iso).toISOString();
  const line = (id: number, reason: string, title: string, quiet: boolean, when: string) => ({
    id: `00000000-0000-4000-8000-00000000000${String(id)}`,
    reason,
    title,
    url: '/agenda',
    quiet,
    at: at(when),
  });

  it('says first how many never rang, then each line under its family’s colour, a touch from its page', async () => {
    serve(200, {
      items: [
        line(1, 'sale', 'Nouvelle vente', false, '2026-11-21T09:00:00Z'),
        line(2, 'reminder', 'Story du jour', true, '2026-11-21T06:00:00Z'),
        line(3, 'safety_alert', 'Un fan à regarder', true, '2026-11-20T23:00:00Z'),
      ],
    });
    deviceIs('on');
    renderPage();
    expect(await screen.findByText('2 arrivées sans sonner')).toBeTruthy();
    expect(screen.getByText('sur 3 cette semaine')).toBeTruthy();
    expect(screen.getByText('Story du jour').closest('a')?.getAttribute('data-family')).toBe('day');
    expect(screen.getByText('Un fan à regarder').closest('a')?.getAttribute('data-family')).toBe('safety');
    expect(screen.getAllByText('Sans sonner')).toHaveLength(2);
    // A family of the legend lit by the keyboard: the others step back (the lines follow, in CSS).
    const safety = screen.getByRole('button', { name: /Sécurité/u });
    fireEvent.focus(safety);
    expect(safety.getAttribute('aria-pressed')).toBe('true');
    expect(safety.closest('.nv-inbox__body')?.getAttribute('data-lit')).toBe('safety');
  });

  it('says so when the week was quiet', async () => {
    serve();
    deviceIs('on');
    renderPage();
    expect(await screen.findByText('Rien cette semaine')).toBeTruthy();
  });
});
