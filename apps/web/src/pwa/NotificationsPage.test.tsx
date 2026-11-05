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

const DEFAULTS = { quietHours: { startMinute: 1320, endMinute: 480 }, dailyCap: 6 };

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/** The server: preferences kept as written, the test send answered with `testStatus`. */
function serve(testStatus = 200): Call[] {
  const calls: Call[] = [];
  let saved: unknown = DEFAULTS;
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

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: NotificationsPage });
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
    expect(start).toHaveProperty('value', '22:00');
    expect(screen.getByLabelText('Fin des heures calmes')).toHaveProperty('value', '08:00');
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
  });
});
