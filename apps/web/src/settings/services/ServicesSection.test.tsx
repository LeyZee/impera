// @vitest-environment jsdom
import type { ProviderOverview, ProviderStatus } from '@nirvana/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordPrompt } from './PasswordPrompt';
import { ServicesSection } from './ServicesSection';
import { fetchOverview, ServicesError } from './api';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  fetchOverview: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function status(provider: ProviderStatus['provider'], patch: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider,
    state: 'connected',
    source: 'dashboard',
    keyLabel: null,
    verifiedAt: null,
    isUnreadable: false,
    message: 'Connecté',
    facts: [],
    settings: {},
    voices: [],
    ...patch,
  };
}

/** Grok refused, Mistral not connected: the agent writes no more. */
const refused: ProviderOverview = {
  services: [
    status('xai', {
      state: 'needs_reconnect',
      message: 'xAI refuse la clé. Seul Mistral, s’il est branché, écrit en attendant.',
    }),
    status('google'),
    status('elevenlabs'),
    status('mistral', { state: 'not_connected', source: null, message: 'Recommandé' }),
  ],
  next: {
    kind: 'replace_key',
    provider: 'xai',
    lead: 'xAI refuse la clé. Seul Mistral, s’il est branché, écrit en attendant.',
    detail: 'Remplace la clé.',
  },
};

describe('Réglages › Modèles IA', () => {
  it('says the agent writes no more, once, and gives Grok’s row two words', async () => {
    vi.mocked(fetchOverview).mockResolvedValue(refused);
    render(<ServicesSection />);
    expect(
      await screen.findByText(
        'L’agent n’écrit plus : xAI refuse la clé de Grok et aucun relais n’est branché.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Clé refusée')).toBeTruthy();
    expect(screen.queryByText(/Seul Mistral, s’il est branché/)).toBeNull();
    // No progress bar repeating the dots of the list.
    expect(screen.queryByRole('img', { name: /services sur/ })).toBeNull();
    // Each service is labelled by what it does, not by who sells it.
    expect(screen.getByText('Écrit')).toBeTruthy();
    expect(screen.getByText('Regarde les médias')).toBeTruthy();
  });

  it('asks to keep before the destructive action, on the right', async () => {
    vi.mocked(fetchOverview).mockResolvedValue(refused);
    render(<ServicesSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Options de Gemini' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Déconnecter' }));
    const confirm = screen.getByText('Déconnecter Gemini ?').closest('.nv-confirm');
    if (!(confirm instanceof HTMLElement)) throw new Error('no confirmation');
    expect(
      within(confirm)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Garder', 'Déconnecter']);
  });

  it('marks a key from the environment with a quiet chip', async () => {
    vi.mocked(fetchOverview).mockResolvedValue({
      ...refused,
      services: [status('xai', { source: 'environment' })],
      next: { kind: 'all_set', lead: 'Tout est connecté', detail: 'd' },
    });
    render(<ServicesSection />);
    expect(await screen.findByText('Mode développement')).toBeTruthy();
    expect(screen.queryByText(/environnement de développement/)).toBeNull();
  });

  it('says the server does not answer, then what could not be read', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new ServicesError('unavailable', 'GET : 500'));
    render(<ServicesSection />);
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.getByText('L’état des clés n’a pas pu être lu. Réessaie dans un instant.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
});

describe('the password prompt', () => {
  it('names its field with a visible label, and says the key waits', () => {
    render(
      <PasswordPrompt
        note="Ta clé est gardée, elle sera vérifiée juste après."
        onConfirmed={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Mot de passe').getAttribute('type')).toBe('password');
    expect(screen.getByText('Mot de passe').tagName).toBe('LABEL');
    expect(screen.getByText('Ta clé est gardée, elle sera vérifiée juste après.')).toBeTruthy();
  });
});
