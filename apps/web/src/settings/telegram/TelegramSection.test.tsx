// @vitest-environment jsdom
import { TelegramBotIdSchema, TelegramChatIdSchema } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramSection } from './TelegramSection';
import { TelegramForbidden, TelegramOff, fetchOverview, removeChat } from './api';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  fetchOverview: vi.fn(),
  removeChat: vi.fn(),
}));

function renderSection(): void {
  render(<TelegramSection />);
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('Réglages › Bots Telegram when the page cannot load', () => {
  it('blames the server, not Telegram, when Impera itself does not answer', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TypeError('Failed to fetch'));
    renderSection();
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.queryByText(/Telegram ne répond pas/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('says Telegram is off when the server runs without it', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TelegramOff());
    renderSection();
    expect(await screen.findByText('Telegram n’est pas activé sur ce serveur')).toBeTruthy();
    // An installation setting, said without the server's vocabulary.
    expect(screen.queryByText(/CREDENTIALS_ENCRYPTION_KEYS/)).toBeNull();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
  });

  it('tells a member who is not the owner whose page it is, with nothing to retry', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TelegramForbidden());
    renderSection();
    expect(await screen.findByText('Seul le propriétaire règle les bots Telegram')).toBeTruthy();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });
});

describe('Réglages › Bots Telegram with a bot Telegram refuses', () => {
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b2'),
          username: 'refuse_bot',
          displayName: 'Refusé',
          state: 'refused',
          lastPolledAt: null,
          chats: [
            {
              id: TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c2'),
              title: 'Canal de Nora',
              kind: 'channel',
              membership: 'member',
              canPost: true,
              lastSentAt: null,
              lastError: null,
            },
          ],
        },
      ],
    });
  });

  it('lights « Réparer » alone, without a second button that does the same', async () => {
    renderSection();
    const fix = await screen.findByRole('button', { name: 'Réparer' });
    expect(fix.className).toContain('nv-btn--neon');
    expect(screen.queryByRole('button', { name: 'Remplacer le jeton' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ajouter un bot' }).className).not.toContain('nv-btn--neon');
  });

  it('says it will no longer publish in its one channel when it is removed', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText(/Il ne publiera plus dans son canal\./)).toBeTruthy();
  });

  it('says nothing of alerts, routes or tests any more (27/11/2026)', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'Réparer' });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Envoyer un test' })).toBeNull();
    expect(screen.getByText(/Les alertes de l’agence arrivent en notification Impera/)).toBeTruthy();
  });
});

describe('Réglages › Bots Telegram without a bot', () => {
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({ bots: [] });
  });

  it('shows one empty state and its one action', async () => {
    renderSection();
    expect(await screen.findByText('Aucun bot pour l’instant')).toBeTruthy();
    const [add, ...more] = screen.getAllByRole('button', { name: 'Ajouter un bot' });
    expect(more).toHaveLength(0);
    expect(add?.className).toContain('nv-btn--neon');
  });
});

describe('Réglages › Bots Telegram with a channel the bot was banned from (REG-28)', () => {
  const gone = TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c9');
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b9'),
          username: 'demo_bot',
          displayName: 'Démo',
          state: 'active',
          lastPolledAt: null,
          chats: [
            {
              id: TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c8'),
              title: 'Canal de Nora',
              kind: 'channel',
              membership: 'member',
              canPost: true,
              lastSentAt: null,
              lastError: null,
            },
            {
              id: gone,
              title: 'Ancien canal',
              kind: 'channel',
              membership: 'kicked',
              canPost: false,
              lastSentAt: null,
              lastError: null,
            },
          ],
        },
      ],
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('says why, asks in the page, and removes the channel only once confirmed', async () => {
    vi.mocked(removeChat).mockResolvedValue('removed');
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer de la liste' }));
    expect(screen.getByText('Canal · le bot a été exclu ici')).toBeTruthy();
    expect(screen.getByText('Retirer Ancien canal de la liste ?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }));
    expect(removeChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(removeChat).toHaveBeenCalledWith(gone);
    });
  });

  it('shows the removal under way and takes no second click', async () => {
    let finish: (result: 'removed') => void = () => undefined;
    vi.mocked(removeChat).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    const busy = await screen.findByRole('button', { name: 'Retrait…' });
    expect(busy).toHaveProperty('disabled', true);
    finish('removed');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retrait…' })).toBeNull();
    });
    expect(removeChat).toHaveBeenCalledTimes(1);
  });

  it('keeps the channel when the bot came back in meanwhile, and says so', async () => {
    vi.mocked(removeChat).mockResolvedValue('still_member');
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le bot est revenu dans Ancien canal : le canal reste.',
    );
  });
});
