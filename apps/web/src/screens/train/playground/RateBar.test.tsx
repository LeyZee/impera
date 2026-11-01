// @vitest-environment jsdom
import type { PlaygroundState } from '@nirvana/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateBar } from './RateBar';

const STATE: PlaygroundState = {
  persona: { name: 'Elena' },
  presets: [],
  presetId: null,
  situation: {
    now: '2026-10-17T21:40:00.000Z',
    timeZone: 'Europe/Paris',
    relationshipStartedAt: '2026-10-17T21:40:00.000Z',
    spentCents: 0,
    isNight: true,
  },
  fanNotes: [],
  history: [],
  rate: { rate: null, rated: 0, validated: 0, target: 0.8, trendPoints: null, previousVersion: null },
  version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
  rejectReasons: [],
  sessionCostEur: 1.5,
  voice: { reachable: true },
  pending: null,
};

/** Where the bar's router is, once a test has rendered it. */
let location = (): string => '';

function renderBar(state: PlaygroundState, isDemo = false): void {
  // « Clé manquante » links to Réglages: the bar needs a router around it.
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <RateBar state={state} isDemo={isDemo} />,
      }),
      createRoute({ getParentRoute: () => root, path: '/reglages/modeles-ia' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  location = () => router.state.location.href;
  render(<RouterProvider router={router} />);
}

describe('RateBar', () => {
  beforeEach(() => {
    // The count-up asks whether motion is reduced.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('names the voice and says what the session cost in euros', async () => {
    renderBar(STATE);
    expect(
      await screen.findByText((_, element) => element?.textContent === '1,50\u00a0€ cette session'),
    ).toBeTruthy();
    expect(screen.queryByText('Clé manquante')).toBeNull();
  });

  it('names the persona it plays, with or without a key', async () => {
    renderBar(STATE);
    const named = await screen.findByText('Persona fictive : Elena');
    // Its rate calibrates the voice on this fictional persona, never on a creator's (ADR 0010).
    expect(named.getAttribute('title')).toBe(
      'Ce taux calibre la voix sur la persona fictive du Playground, pas sur celle d’une créatrice.',
    );
    cleanup();
    renderBar({ ...STATE, voice: { reachable: false } });
    expect(await screen.findByText('Persona fictive : Elena')).toBeTruthy();
  });

  it('says how the rate starts before the first rating', async () => {
    renderBar(STATE);
    expect(await screen.findByText('Note ta première réponse pour lancer le taux')).toBeTruthy();
    expect(screen.queryByText(/Objectif/)).toBeNull();
  });

  it('shows the target and the trend once answers are rated', async () => {
    renderBar({
      ...STATE,
      rate: {
        ...STATE.rate,
        rate: 0.62,
        rated: 34,
        validated: 21,
        trendPoints: -4,
        previousVersion: { voicePrompt: '1.3.0', voiceModel: 'grok-4.7' },
      },
    });
    // How many answers the rate stands on, written out: 62 % on two answers is not 62 % on a hundred.
    expect(await screen.findByText(/Sur 34 réponses notées · objectif 80 %/)).toBeTruthy();
    expect(screen.getByText('-4 pts', { exact: false }).className).toBe('is-down');
  });

  it('never shows the demo’s made-up rate as the screen’s number', async () => {
    renderBar(
      {
        ...STATE,
        rate: {
          ...STATE.rate,
          rate: 0.64,
          rated: 25,
          validated: 16,
          trendPoints: 6,
          previousVersion: { voicePrompt: '1.3.0', voiceModel: 'grok-4.7' },
        },
      },
      true,
    );
    expect(await screen.findByText('Démo : rien n’est noté pour de vrai')).toBeTruthy();
    expect(screen.queryByText(/64/)).toBeNull();
    expect(screen.queryByText(/pts/)).toBeNull();
  });

  it('says before the first message that no key reaches the voice, and leads to its settings', async () => {
    renderBar({ ...STATE, voice: { reachable: false } });
    const key = await screen.findByText('Clé manquante');
    // No model and no amount: nothing suggests a voice ready to write.
    expect(screen.queryByText(/grok-4\.7/)).toBeNull();
    expect(screen.queryByText(/cette session/)).toBeNull();
    fireEvent.click(key);
    await waitFor(() => {
      expect(location()).toBe('/reglages/modeles-ia');
    });
  });
});
