// @vitest-environment jsdom
import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  REAUTHENTICATION_ERROR_CODE,
  SaveTelegramChannelBodySchema,
  type TelegramChannelConfig,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramChannelSection } from './TelegramChannelSection';

import { choose } from '@/test/select';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/* An invented creator and invented channels: no real person, no real address. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const CHANNEL = '0192f3a0-0000-7000-8000-0000000000d1';
const TAKEN = '0192f3a0-0000-7000-8000-0000000000d2';

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const view = (config: TelegramChannelConfig, patch: Record<string, unknown> = {}) => ({
  creatorId: CREATOR,
  config,
  saved: false,
  channels: [
    {
      chatId: CHANNEL,
      title: 'Canal de Nora',
      membership: 'member',
      canPost: true,
      takenByOther: false,
      routedForAlerts: false,
    },
    {
      chatId: TAKEN,
      title: 'Canal de Léa',
      membership: 'member',
      canPost: true,
      takenByOther: true,
      routedForAlerts: false,
    },
  ],
  warnings: ['no_channel', 'no_link'],
  ...patch,
});

const echo = (body: unknown) => ({
  ...view(SaveTelegramChannelBodySchema.parse(body).config),
  saved: true,
  warnings: [],
});

const apiError = (code: string, details: Record<string, unknown> = {}, message = code): unknown => ({
  error: { code, message, details, requestId: 'r1' },
});

function serve(routes: { get?: () => Reply; put?: (body: unknown) => Reply }): unknown[] {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/telegram-channel`);
      const reply =
        init?.method === 'PUT'
          ? (() => {
              const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
              puts.push(body);
              return routes.put?.(body) ?? { status: 500 };
            })()
          : (routes.get?.() ?? { status: 200, body: view(DEFAULT_TELEGRAM_CHANNEL_CONFIG) });
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return puts;
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TelegramChannelSection creatorId={CREATOR} creatorName="Nora" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  confirmIdentity.mockReset();
});

const save = (): HTMLElement => screen.getByRole('button', { name: 'Enregistrer' });

describe('Créatrices › Canal Telegram (ADR 0080 § 6)', () => {
  it('says what keeps her posts in, and offers 19 h every day', async () => {
    serve({});
    renderSection();
    expect(await screen.findByText('Canal Telegram de Nora')).toBeDefined();
    const missing = screen.getByRole('list', { name: 'Ce qui empêche les posts de partir' });
    expect(within(missing).getAllByRole('listitem')).toHaveLength(2);
    const slots = screen.getByRole('list', { name: 'Créneaux' });
    expect(within(slots).getAllByRole('listitem')).toHaveLength(1);
    const days = within(slots).getByRole('group', { name: /^Jours du créneau de 19/u });
    expect(within(days).getAllByRole('button', { pressed: true })).toHaveLength(7);
    expect(save()).toHaveProperty('disabled', true);
  });

  it('saves her channel, a second slot and her first link as the channel’s', async () => {
    const puts = serve({ put: (body) => ({ status: 200, body: echo(body) }) });
    renderSection();
    choose(await screen.findByRole('combobox', { name: 'Son canal' }), /Canal de Nora/u);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un créneau/u }));
    // The new one, three hours after 19 h: 22 h, on weekdays only.
    const second = within(screen.getByRole('list', { name: 'Créneaux' })).getAllByRole('listitem')[1];
    if (second === undefined) throw new Error('no second slot');
    for (const day of ['samedi', 'dimanche'])
      fireEvent.click(within(second).getByRole('button', { name: day }));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un lien/u }));
    fireEvent.change(screen.getByLabelText('Nom de ce lien'), { target: { value: 'Telegram' } });
    fireEvent.change(screen.getByLabelText('Adresse du lien « Telegram »'), {
      target: { value: ' https://redirect.example.test/nora ' },
    });
    fireEvent.change(screen.getByLabelText('Où il mène (le lien « Telegram »)'), {
      target: { value: 'mon live TikTok ce soir 21 h ' },
    });
    expect(screen.getByRole('button', { name: 'Lien du canal : le lien « Telegram »' })).toHaveProperty(
      'ariaPressed',
      'true',
    );
    expect(screen.getByText('Viens me parler ✨')).toBeDefined();
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const sent = SaveTelegramChannelBodySchema.parse(puts[0]).config;
    expect(sent.chatId).toBe(CHANNEL);
    expect(sent.slots).toEqual([
      { minute: 1140, days: [1, 2, 3, 4, 5, 6, 7], enabled: true },
      { minute: 1320, days: [1, 2, 3, 4, 5], enabled: true },
    ]);
    expect(sent.links).toEqual([
      {
        id: sent.channelLinkId,
        name: 'Telegram',
        url: 'https://redirect.example.test/nora',
        destination: 'mon live TikTok ce soir 21 h',
      },
    ]);
    expect(await screen.findByText('Enregistré : les posts partiront à ces créneaux.')).toBeDefined();
  });

  it('keeps the save shut on an address that is not https, and says why', async () => {
    serve({});
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter un lien/u }));
    fireEvent.change(screen.getByLabelText('Nom de ce lien'), { target: { value: 'Telegram' } });
    fireEvent.change(screen.getByLabelText('Adresse du lien « Telegram »'), {
      target: { value: 'http://redirect.example.test/nora' },
    });
    expect(screen.getByText('Une adresse complète qui commence par https://, sans espace.')).toBeDefined();
    expect(save()).toHaveProperty('disabled', true);
  });

  it('shows the server’s sentence when it refuses', async () => {
    const sentence = 'Le lundi, 19 h et 20 h sont trop proches : 3 h d’écart au moins.';
    serve({
      put: () => ({
        status: 400,
        body: apiError('telegram_channel_invalid', { kind: 'slots_too_close' }, sentence),
      }),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: /^Publier sans validation/u }));
    fireEvent.click(save());
    expect(await screen.findByText(sentence)).toBeDefined();
  });

  it('asks the password and the code when the sign-in is old', async () => {
    const puts = serve({ put: () => ({ status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) }) });
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: /^Publier sans validation/u }));
    fireEvent.click(save());
    expect(await screen.findByText(/Pour changer son canal Telegram/u)).toBeDefined();
    expect(puts).toHaveLength(1);
  });
});
