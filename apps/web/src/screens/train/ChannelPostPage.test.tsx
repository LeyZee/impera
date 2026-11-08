// @vitest-environment jsdom
import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TryChannelPostBodySchema,
  type TelegramChannelConfig,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelPostPage } from './ChannelPostPage';
import { violationLabel } from './channel/model';

import { choose } from '@/test/select';

/* An invented creator, invented links: no real person, no real address. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const LIVE = RedirectLinkIdSchema.parse('0192f3a0-0000-7000-8000-0000000000e1');
const SHOP = RedirectLinkIdSchema.parse('0192f3a0-0000-7000-8000-0000000000e2');

const config: TelegramChannelConfig = {
  ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  links: [
    { id: LIVE, name: 'Live', url: 'https://redirect.example.test/live', destination: 'mon live ce soir' },
    { id: SHOP, name: 'Boutique', url: 'https://redirect.example.test/shop', destination: 'ma boutique' },
  ],
  channelLinkId: LIVE,
};

const post = {
  draft: {
    kind: 'post',
    segments: [
      { text: 'Ce soir ', style: 'plain' },
      { text: 'je suis là', style: 'bold' },
      { text: ' ✨', style: 'plain' },
    ],
    link: { text: 'Viens me voir', url: 'https://redirect.example.test/shop', name: 'Boutique' },
    html: 'Ce soir <b>je suis là</b> ✨\n\n<a href="https://redirect.example.test/shop">Viens me voir</a>',
  },
  violations: [{ code: 'explicit_before_age', blocking: true, match: null }],
  personaVersion: '1.0.0',
};

const poll = {
  draft: { kind: 'poll', question: 'Vous préférez quoi ce soir ?', options: ['Un live', 'Une photo'] },
  violations: [],
  personaVersion: '1.0.0',
};

function serve(tried: (body: unknown) => { status: number; body: unknown }): unknown[] {
  const asked: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const reply = (() => {
        if (url === '/v1/creators') {
          return {
            status: 200,
            body: { creators: [{ id: CREATOR, displayName: 'Nora', timezone: 'Europe/Paris' }] },
          };
        }
        if (url === `/v1/creators/${CREATOR}/telegram-channel`) {
          return {
            status: 200,
            body: { creatorId: CREATOR, config, saved: true, channels: [], warnings: [] },
          };
        }
        if (url === `/v1/creators/${CREATOR}/telegram-channel/try` && init?.method === 'POST') {
          const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
          asked.push(body);
          return tried(body);
        }
        return { status: 404, body: null };
      })();
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    }),
  );
  return asked;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChannelPostPage />
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
});

describe('Entraîner › Post du canal (ADR 0080 § 7)', () => {
  it('writes her post with the link chosen, shows it as Telegram does and says the guard', async () => {
    const asked = serve(() => ({ status: 200, body: post }));
    renderPage();
    expect(await screen.findByText(/Rien n’est publié/u)).toBeDefined();
    choose(await screen.findByRole('combobox', { name: 'Lien' }), 'Boutique');
    fireEvent.change(screen.getByLabelText('Le média'), { target: { value: ' selfie au miroir ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Écrire' }));
    const bubble = await screen.findByRole('article', { name: 'Le post' });
    expect(within(bubble).getByText('je suis là').tagName).toBe('STRONG');
    expect(within(bubble).getByRole('link', { name: 'Viens me voir' })).toHaveProperty(
      'href',
      'https://redirect.example.test/shop',
    );
    expect(screen.getByText('Ne partirait pas : du contenu explicite sur un canal public.')).toBeDefined();
    expect(TryChannelPostBodySchema.parse(asked[0])).toEqual({
      kind: 'post',
      media: 'selfie au miroir',
      advice: null,
      linkId: SHOP,
    });
    expect(screen.getByRole('button', { name: 'Réécrire' })).toBeDefined();
  });

  it('writes a poll without a link nor a media', async () => {
    const asked = serve(() => ({ status: 200, body: poll }));
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Sondage' }));
    expect(screen.queryByLabelText('Le média')).toBeNull();
    fireEvent.change(screen.getByLabelText('Conseil de l’agence'), { target: { value: 'parle du live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Écrire' }));
    expect(await screen.findByText('Vous préférez quoi ce soir ?')).toBeDefined();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Un live', 'Une photo']);
    expect(screen.getByText('Aucune garde levée. Fiche 1.0.0, rien n’est publié.')).toBeDefined();
    expect(TryChannelPostBodySchema.parse(asked[0])).toEqual({
      kind: 'poll',
      media: null,
      advice: 'parle du live',
      linkId: null,
    });
  });

  it('says the server’s sentence when she has no persona', async () => {
    const sentence = 'Aucune fiche active pour elle : active sa persona d’abord.';
    serve(() => ({
      status: 400,
      body: {
        error: {
          code: 'telegram_channel_try_invalid',
          message: sentence,
          details: { kind: 'no_persona' },
          requestId: 'r1',
        },
      },
    }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Écrire' }));
    expect(await screen.findByText(sentence)).toBeDefined();
  });

  it('says a soft guard as one to look at, with the words it caught', () => {
    expect(violationLabel({ code: 'ai_tic', blocking: false, match: 'en tant que' })).toBe(
      'À revoir : un tic d’IA (« en tant que »).',
    );
  });
});
