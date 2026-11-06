// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReauthRequired, confirmIdentity } from '../services/api';

import { PrivateChat } from './PrivateChat';
import { LinkUnavailable, fetchPrivateLink, requestLinkCode, unlinkPrivateChat } from './api';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  fetchPrivateLink: vi.fn(),
  requestLinkCode: vi.fn(),
  unlinkPrivateChat: vi.fn(),
}));
vi.mock('../services/api', async (actual) => ({
  ...(await actual<typeof import('../services/api')>()),
  confirmIdentity: vi.fn(),
}));

const UNLINKED = { linked: false, botUsername: null, linkedAt: null };
const LINKED = { linked: true, botUsername: 'demo_bot', linkedAt: '2026-11-06T05:40:00.000Z' };
const CODE = {
  code: 'ABCDEFGH23',
  botUsername: 'demo_bot',
  url: 'https://t.me/demo_bot?start=ABCDEFGH23',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

const frame = (body: JSX.Element): JSX.Element => <section aria-label="Mon chat privé">{body}</section>;

function renderChat(owner = false, onAddBot?: () => void): void {
  render(
    onAddBot === undefined ? (
      <PrivateChat owner={owner} frame={frame} />
    ) : (
      <PrivateChat owner={owner} onAddBot={onAddBot} frame={frame} />
    ),
  );
}

/** She comes back from Telegram: the page reads the link again. */
function comeBack(): void {
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('« Mon chat privé » (SEC-05 lot 2)', () => {
  it('shows nothing where the server does not serve it (a creator, a server without Telegram)', async () => {
    vi.mocked(fetchPrivateLink).mockRejectedValue(new LinkUnavailable());
    renderChat();
    await waitFor(() => {
      expect(fetchPrivateLink).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Mon chat privé' })).toBeNull();
    });
  });

  it('gives a code, opens the bot with it, and says « C’est fait » once the bot linked the chat', async () => {
    vi.mocked(fetchPrivateLink).mockResolvedValue(UNLINKED);
    vi.mocked(requestLinkCode).mockResolvedValue(CODE);
    renderChat();
    expect(await screen.findByText(/Ce chat ne reçoit rien d’autre/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lier mon Telegram' }));

    const open = await screen.findByRole('link', { name: 'Ouvrir Telegram' });
    expect(open.getAttribute('href')).toBe(CODE.url);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('/start ABCDEFGH23')).toBeTruthy();
    expect(screen.getByText(/Valable jusqu’à/u)).toBeTruthy();
    expect(screen.getByText('En attente du bot…')).toBeTruthy();

    vi.mocked(fetchPrivateLink).mockResolvedValue(LINKED);
    comeBack();
    expect(await screen.findByText('@demo_bot')).toBeTruthy();
    expect(screen.getByText('06/11/2026')).toBeTruthy();
    expect(screen.queryByText('/start ABCDEFGH23')).toBeNull();
  });

  it('gives the code up with « Annuler », and asks a new one after', async () => {
    vi.mocked(fetchPrivateLink).mockResolvedValue(UNLINKED);
    vi.mocked(requestLinkCode).mockResolvedValue(CODE);
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Lier mon Telegram' }));
    await screen.findByText('/start ABCDEFGH23');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText('/start ABCDEFGH23')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lier mon Telegram' }));
    expect(await screen.findByText('/start ABCDEFGH23')).toBeTruthy();
    expect(requestLinkCode).toHaveBeenCalledTimes(2);
  });

  it('asks the password and the code when the sign-in is old, then asks the code again', async () => {
    vi.mocked(fetchPrivateLink).mockResolvedValue(UNLINKED);
    vi.mocked(requestLinkCode).mockRejectedValueOnce(new ReauthRequired()).mockResolvedValueOnce(CODE);
    vi.mocked(confirmIdentity).mockResolvedValue('ok');
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Lier mon Telegram' }));
    expect(
      await screen.findByText('Pour lier ton Telegram, confirme ton mot de passe et ton code.'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret-de-test' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('/start ABCDEFGH23')).toBeTruthy();
    expect(requestLinkCode).toHaveBeenCalledTimes(2);
  });

  it('sends the owner to his bots when none can take the code, and anyone else to him', async () => {
    vi.mocked(fetchPrivateLink).mockResolvedValue(UNLINKED);
    vi.mocked(requestLinkCode).mockResolvedValue('no_bot');
    const onAddBot = vi.fn();
    renderChat(true, onAddBot);
    fireEvent.click(await screen.findByRole('button', { name: 'Lier mon Telegram' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bots et groupes' }));
    expect(onAddBot).toHaveBeenCalled();
    // One way out only: no « Lier mon Telegram » that would fail the same way.
    expect(screen.queryByRole('button', { name: 'Lier mon Telegram' })).toBeNull();
    cleanup();

    renderChat(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Lier mon Telegram' }));
    expect(await screen.findByText(/demande au propriétaire de s’en occuper/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bots et groupes' })).toBeNull();
  });

  it('unlinks only once confirmed', async () => {
    vi.mocked(fetchPrivateLink).mockResolvedValue(LINKED);
    vi.mocked(unlinkPrivateChat).mockResolvedValue(UNLINKED);
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Délier' }));
    expect(unlinkPrivateChat).not.toHaveBeenCalled();
    expect(screen.getByText(/Tu ne pourras plus y recevoir le lien/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Délier' }));
    expect(await screen.findByText('Ce chat est délié : il ne recevra plus rien d’Impera.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lier mon Telegram' })).toBeTruthy();
  });
});
