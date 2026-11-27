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

/** Her links that are on, as « Liens » holds them: the section reads them and only chooses the channel's. */
const LINKS = [
  {
    id: '0192f3a0-0000-7000-8000-0000000000e1',
    name: 'Telegram',
    url: 'https://redirect.example.test/nora',
    destination: 'mon live TikTok ce soir 21 h',
  },
  {
    id: '0192f3a0-0000-7000-8000-0000000000e2',
    name: 'Story',
    url: 'https://redirect.example.test/story',
    destination: '',
  },
];
const withLinks = (): Reply => ({
  status: 200,
  body: view(
    SaveTelegramChannelBodySchema.parse({ config: { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, links: LINKS } })
      .config,
  ),
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
      <TelegramChannelSection creatorId={CREATOR} />
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
  it('says what keeps her posts in, and offers her three windows every day (ADR 0162 § 2)', async () => {
    serve({});
    renderSection();
    expect(await screen.findByText('Son canal Telegram')).toBeDefined();
    const missing = screen.getByRole('list', { name: 'Ce qui empêche les posts de partir' });
    expect(within(missing).getAllByRole('listitem')).toHaveLength(2);
    const slots = screen.getByRole('list', { name: 'Créneaux' });
    expect(within(slots).getAllByRole('listitem')).toHaveLength(3);
    const days = within(slots).getByRole('group', { name: /^Jours du créneau de 18/u });
    expect(within(days).getAllByRole('button', { pressed: true })).toHaveLength(7);
    expect(save()).toHaveProperty('disabled', true);
  });

  it('saves her channel, a second slot and the link chosen for the channel', async () => {
    const puts = serve({ get: withLinks, put: (body) => ({ status: 200, body: echo(body) }) });
    renderSection();
    choose(await screen.findByRole('combobox', { name: 'Son canal' }), /Canal de Nora/u);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un créneau/u }));
    // The new one, two hours after 18 h: 20 h, on weekdays only.
    const second = within(screen.getByRole('list', { name: 'Créneaux' })).getAllByRole('listitem')[3];
    if (second === undefined) throw new Error('no second slot');
    for (const day of ['samedi', 'dimanche'])
      fireEvent.click(within(second).getByRole('button', { name: day }));
    // Her links are read, never typed here: no field for a name or an address, no way to add or remove one.
    expect(screen.queryByRole('button', { name: /Ajouter un lien/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retirer le lien/u })).toBeNull();
    expect(screen.getByText('Mène à : mon live TikTok ce soir 21 h')).toBeDefined();
    // The chosen link says so as a state; the others offer to take its place.
    fireEvent.click(screen.getByRole('button', { name: 'Choisir le lien « Telegram » pour le canal' }));
    expect(screen.queryByRole('button', { name: 'Choisir le lien « Telegram » pour le canal' })).toBeNull();
    expect(screen.getAllByText('Lien du canal')).toHaveLength(1);
    expect(screen.getByLabelText('Texte du lien')).toHaveProperty('value', 'Viens me parler ✨');
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const sent = SaveTelegramChannelBodySchema.parse(puts[0]).config;
    expect(sent.chatId).toBe(CHANNEL);
    expect(sent.slots).toEqual([
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG.slots,
      { minute: 1200, role: 'engagement', days: [1, 2, 3, 4, 5], enabled: true },
    ]);
    // The links go back as they were read: the server refuses a save that changes them.
    expect(sent.links).toEqual(LINKS);
    expect(sent.channelLinkId).toBe(LINKS[0]?.id);
    expect(await screen.findByText('Enregistré : les posts partiront à ces créneaux.')).toBeDefined();
  });

  it('saves her example posts trimmed, and keeps the save shut on an empty line', async () => {
    const puts = serve({ put: (body) => ({ status: 200, body: echo(body) }) });
    renderSection();
    choose(await screen.findByRole('combobox', { name: 'Son canal' }), /Canal de Nora/u);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un exemple/u }));
    // Just added and blank: « à compléter », never flagged in red before she writes (recette créatrice 10).
    expect(screen.queryByText('Colle le post, ou retire la ligne.')).toBeNull();
    expect(screen.getAllByText('Une ligne à compléter').length).toBeGreaterThan(0);
    expect(save()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Exemple 1'), { target: { value: ' Ce soir je suis là ✨ ' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un exemple/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’exemple 2' }));
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(SaveTelegramChannelBodySchema.parse(puts[0]).config.examples).toEqual(['Ce soir je suis là ✨']);
  });

  it('makes a new slot an engagement post, and refuses a second main post on a day', async () => {
    serve({});
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter un créneau/u }));
    const role = screen.getByRole('combobox', { name: /^Rôle du créneau de 20/u });
    expect(role.textContent).toContain('Engagement');
    choose(role, 'Principal');
    expect(screen.getByText('Un seul post principal par jour.')).toBeDefined();
    expect(save()).toHaveProperty('disabled', true);
  });

  it('sends to « Liens » when she has no link that is on', async () => {
    serve({});
    renderSection();
    expect(
      await screen.findByText('Aucun lien allumé pour l’instant : ajoute-en un dans Trafic.'),
    ).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Liens de redirection' })).toBeNull();
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
