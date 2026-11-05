// @vitest-environment jsdom
import {
  CreatorIdSchema,
  PersonaVersionIdSchema,
  type PlaygroundPersonaBody,
  type PlaygroundState,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PersonaPicker } from './PersonaPicker';
import type { PlaygroundClient } from './client';
import type { Playground } from './usePlayground';

/* Invented creators and versions: no real data (ADR 0010). */
const MIA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const NINA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c2');
const LIVE = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e2');
const DRAFT = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e3');

const BASE: PlaygroundState = {
  persona: { name: 'Elena', played: null },
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
  sessionCostEur: 0,
  voice: { reachable: true },
  pending: null,
};

const summary = (id: string, version: string, isActive: boolean) => ({
  id,
  version,
  isActive,
  contentHash: (isActive ? 'a' : 'b').repeat(64),
  createdAt: '2026-11-01T10:00:00.000Z',
});

/** Mia has 0.0.3 not yet active over 0.0.2 in force; Nina has no persona. */
function serve(activate: { status: number; body: unknown } = { status: 200, body: {} }): unknown[] {
  const asked: unknown[] = [];
  let active = LIVE;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/v1/creators') {
        return json({
          creators: [
            { id: MIA, displayName: 'Mia', timezone: 'Europe/Paris' },
            { id: NINA, displayName: 'Nina', timezone: 'Europe/Paris' },
          ],
        });
      }
      if (url === `/v1/creators/${MIA}/persona`) {
        return json({
          creatorId: MIA,
          latest: null,
          versions: [summary(DRAFT, '0.0.3', active === DRAFT), summary(LIVE, '0.0.2', active === LIVE)],
        });
      }
      if (url === `/v1/creators/${NINA}/persona`)
        return json({ creatorId: NINA, latest: null, versions: [] });
      if (url.endsWith('/activate') && init?.method === 'POST') {
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '');
        asked.push({ url, body });
        if (activate.status === 200) active = DRAFT;
        return json(activate.body, activate.status);
      }
      return json({}, 404);
    }),
  );
  return asked;
}

/** The playground as the screen holds it: each choice answers the state the server would. */
function show(state: PlaygroundState): { chosen: PlaygroundPersonaBody[] } {
  const chosen: PlaygroundPersonaBody[] = [];
  let current = state;
  const choosePersona = (body: PlaygroundPersonaBody): Promise<PlaygroundState> => {
    chosen.push(body);
    current =
      body.kind === 'invented'
        ? { ...BASE }
        : {
            ...BASE,
            persona: {
              name: 'Mia',
              played: {
                creatorId: body.creatorId,
                versionId: body.versionId,
                version: body.versionId === DRAFT ? '0.0.3' : '0.0.2',
              },
            },
          };
    rerender();
    return Promise.resolve(current);
  };
  const client: Pick<PlaygroundClient, 'isDemo' | 'choosePersona'> = { isDemo: false, choosePersona };
  const pg = (): Playground => ({
    client: { ...stubClient(), ...client },
    state: current,
    isLoading: false,
    busy: false,
    error: undefined,
    run: async (call) => {
      await call({ ...stubClient(), ...client });
      return true;
    },
    fail: () => undefined,
    retry: () => undefined,
    switchToDemo: () => undefined,
  });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={queries}>
      <PersonaPicker state={current} pg={pg()} />
    </QueryClientProvider>
  );
  const { rerender: again } = render(tree());
  function rerender(): void {
    again(tree());
  }
  return { chosen };
}

const unused = (): never => {
  throw new Error('not used');
};
function stubClient(): PlaygroundClient {
  return {
    isDemo: false,
    state: unused,
    choosePreset: unused,
    choosePersona: unused,
    reset: unused,
    send: unused,
    rate: unused,
    branch: unused,
    compare: unused,
    advance: unused,
    setNotes: unused,
    setSpent: unused,
    sendCreatorMedia: unused,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PersonaPicker (PRO-21)', () => {
  it('plays her version in force first, lets a version not yet active be heard, then activates it', async () => {
    const asked = serve();
    const { chosen } = show(BASE);
    // Chips of the design system, never a native menu that cuts « en vigueur » (PRO-21 captures).
    expect(screen.getByRole('radiogroup', { name: 'Persona' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Fictive (Elena)' })).toHaveProperty('ariaChecked', 'true');
    fireEvent.click(await screen.findByRole('radio', { name: 'Mia' }));
    await waitFor(() => {
      expect(chosen).toEqual([{ kind: 'version', creatorId: MIA, versionId: LIVE }]);
    });
    expect(await screen.findByText(/La version que lisent ses fans/u)).toBeDefined();
    expect(screen.getByRole('radio', { name: '0.0.2 · en vigueur' })).toHaveProperty('ariaChecked', 'true');
    expect(screen.queryByRole('button', { name: 'Activer cette version' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '0.0.3' }));
    await waitFor(() => {
      expect(chosen.at(-1)).toEqual({ kind: 'version', creatorId: MIA, versionId: DRAFT });
    });
    expect(await screen.findByText(/Pas encore active/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Activer cette version' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Version 0.0.3 activée : ses prochains brouillons l’écrivent avec elle.',
    );
    // Once activated, the screen says so everywhere: no « Pas encore active » left beside « activée ».
    expect(screen.queryByText(/Pas encore active/u)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activer cette version' })).toBeNull();
    expect(screen.getByRole('radio', { name: '0.0.3 · en vigueur' })).toHaveProperty('ariaChecked', 'true');
    // The server is told which version this screen saw in force: another tab's change is refused, not overwritten.
    expect(asked).toEqual([
      {
        url: `/v1/creators/${MIA}/persona/versions/${DRAFT}/activate`,
        body: { expectedActive: LIVE },
      },
    ]);

    fireEvent.click(screen.getByRole('radio', { name: 'Fictive' }));
    await waitFor(() => {
      expect(chosen.at(-1)).toEqual({ kind: 'invented' });
    });
  });

  it('says so when she has no persona yet, and asks for the password before activating after 10 minutes', async () => {
    serve({
      status: 403,
      body: { error: { code: 'reauthentication_forbidden', message: '', details: {}, requestId: 'r' } },
    });
    const { chosen } = show(BASE);
    fireEvent.click(await screen.findByRole('radio', { name: 'Nina' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nina n’a pas encore de persona : écris-la dans Créatrices.',
    );
    expect(chosen).toEqual([]);

    cleanup();
    show({
      ...BASE,
      persona: { name: 'Mia', played: { creatorId: MIA, versionId: DRAFT, version: '0.0.3' } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Activer cette version' }));
    expect(await screen.findByText(/confirme ton mot de passe et ton code/u)).toBeDefined();
  });
});
