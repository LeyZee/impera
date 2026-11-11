// @vitest-environment jsdom
import {
  CreatorIdSchema,
  PersonaVersionIdSchema,
  type PlaygroundPersonaBody,
  type PlaygroundState,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** Mia has 0.0.3 not yet active over 0.0.2 in force (none with `miaInForce` false); Nina has no persona. */
function serve(
  activate: { status: number; body: unknown } = { status: 200, body: {} },
  more = 0,
  miaInForce = true,
): unknown[] {
  const asked: unknown[] = [];
  let active: string | null = miaInForce ? LIVE : null;
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
          versions: [
            summary(DRAFT, '0.0.3', active === DRAFT),
            summary(LIVE, '0.0.2', active === LIVE),
            // Older versions, when a test asks for more than chips can hold.
            ...Array.from({ length: more }, (_, i) =>
              summary(
                `0199f2a0-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
                `0.1.${String(i)}`,
                false,
              ),
            ),
          ],
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
    // As the server answers: after the call, never inside React's own work (the scene may be chosen by an effect).
    return Promise.resolve().then(() => {
      act(rerender);
      return current;
    });
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

describe('PersonaPicker (PRO-21, Charles 11/11)', () => {
  it('opens on the first creator’s version in force, never the invented persona nor an older version', async () => {
    serve();
    const { chosen } = show(BASE);
    await waitFor(() => {
      expect(chosen).toEqual([{ kind: 'version', creatorId: MIA, versionId: LIVE }]);
    });
    // Chips of the design system, never a native menu that cuts its words (PRO-21 captures).
    expect(screen.getByRole('radiogroup', { name: 'Persona' })).toBeDefined();
    expect(screen.queryByRole('radio', { name: /Fictive/u })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Mia' })).toHaveProperty('ariaChecked', 'true');
    expect(await screen.findByText('Version 0.0.2')).toBeDefined();
    expect(screen.queryByText(/0\.0\.3/u)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activer cette version' })).toBeNull();
    expect(screen.getByText(/Sa version en vigueur, celle que lisent ses fans/u)).toBeDefined();
  });

  it('says so when a creator has no persona in force, and plays nothing', async () => {
    serve();
    const { chosen } = show({
      ...BASE,
      persona: { name: 'Mia', played: { creatorId: MIA, versionId: LIVE, version: '0.0.2' } },
    });
    fireEvent.click(await screen.findByRole('radio', { name: 'Nina' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nina n’a pas de persona en vigueur : active-en une dans Créatrices › Persona.',
    );
    expect(chosen).toEqual([]);
  });

  it('follows the version put in force since the scene began', async () => {
    serve();
    const { chosen } = show({
      ...BASE,
      persona: { name: 'Mia', played: { creatorId: MIA, versionId: DRAFT, version: '0.0.3' } },
    });
    await waitFor(() => {
      expect(chosen).toEqual([{ kind: 'version', creatorId: MIA, versionId: LIVE }]);
    });
  });

  it('says so when no creator has a persona in force', async () => {
    serve(undefined, 0, false);
    const { chosen } = show(BASE);
    expect(
      await screen.findByText(
        'Aucune créatrice n’a de persona en vigueur : active-en une dans Créatrices › Persona.',
      ),
    ).toBeDefined();
    expect(chosen).toEqual([]);
  });

  it('moves with the arrows without starting over, and sends one choice for two quick clicks', async () => {
    serve();
    const { chosen } = show({
      ...BASE,
      persona: { name: 'Mia', played: { creatorId: NINA, versionId: LIVE, version: '0.0.2' } },
    });
    const mia = await screen.findByRole('radio', { name: 'Mia' });
    const nina = screen.getByRole('radio', { name: 'Nina' });
    nina.focus();
    fireEvent.keyDown(nina, { key: 'ArrowLeft' });
    // The focus is on Mia, nothing chosen: choosing starts the scene over, so it waits for Enter or a click.
    expect(document.activeElement).toBe(mia);
    expect(chosen).toEqual([]);

    fireEvent.click(mia);
    fireEvent.click(nina);
    await waitFor(() => {
      expect(chosen).toEqual([{ kind: 'version', creatorId: MIA, versionId: LIVE }]);
    });
  });
});
