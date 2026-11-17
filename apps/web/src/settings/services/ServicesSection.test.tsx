// @vitest-environment jsdom
import type { ProviderOverview, ProviderStatus } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordPrompt } from './PasswordPrompt';
import { ServicesSection } from './ServicesSection';
import { fetchOverview, probeNow, ServicesError } from './api';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  fetchOverview: vi.fn(),
  probeNow: vi.fn(),
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
    probe: null,
    activity: null,
    quota: null,
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

  it('runs an « Essai réel » on a click, says what it costs, and shows the answer with the day of calls', async () => {
    const before: ProviderOverview = {
      services: [
        status('mistral', {
          activity: { calls: 3, troubled: 0, asFallback: 3, lastSuccessAt: null, lastTrouble: null },
        }),
      ],
      next: { kind: 'all_set', lead: 'Tout est connecté', detail: 'd' },
    };
    const probed = status('mistral', {
      probe: { at: new Date().toISOString(), outcome: 'no_credit', latencyMs: 300, model: 'Mistral Large 4' },
    });
    vi.mocked(fetchOverview)
      .mockResolvedValueOnce(before)
      .mockResolvedValue({ ...before, services: [probed] });
    vi.mocked(probeNow).mockResolvedValue(probed);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ServicesSection />);
    expect(await screen.findByText('3 appels, sans erreur')).toBeTruthy();
    expect(screen.getByText('En relais de Grok')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Essai réel' });
    // The cost is written beside the button, never in a tooltip the phone and the keyboard cannot reach.
    expect(button.hasAttribute('title')).toBe(false);
    expect(screen.getByText(/moins d’un centime/)).toBeTruthy();
    fireEvent.click(button);
    expect(vi.mocked(probeNow)).toHaveBeenCalledWith('mistral');
    expect(await screen.findByText('Plus de crédit')).toBeTruthy();
    expect(screen.getByText(/recharge-le dans la console/)).toBeTruthy();
    // The answer and its hint are siblings: two keys, or React shows the old answer beside the new one.
    expect(warn.mock.calls.some((args) => String(args[0]).includes('same key'))).toBe(false);
    warn.mockRestore();
  });

  it('shows ElevenLabs’ month and says its free offer, with no « Essai réel » for a key of the environment', async () => {
    vi.mocked(fetchOverview).mockResolvedValue({
      services: [
        status('elevenlabs', {
          quota: { used: 2_500, limit: 10_000, resetsAt: '2026-12-01T00:00:00Z', plan: 'free' },
        }),
        status('xai', { source: 'environment' }),
      ],
      next: { kind: 'all_set', lead: 'Tout est connecté', detail: 'd' },
    });
    render(<ServicesSection />);
    expect(await screen.findByRole('meter', { name: 'Caractères ElevenLabs utilisés ce mois' })).toBeTruthy();
    expect(screen.getByText(/l’usage commercial n’y est pas autorisé/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Essai réel' })).toHaveLength(1);
  });

  it('says the server does not answer, then what to do', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new ServicesError('unavailable', 'GET : 500'));
    render(<ServicesSection />);
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.getByText('Réessaie dans un instant.')).toBeTruthy();
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
    expect(screen.getByText('Mot de passe').closest('label')).not.toBeNull();
    expect(screen.getByText('Ta clé est gardée, elle sera vérifiée juste après.')).toBeTruthy();
  });
});
