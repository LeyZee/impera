// @vitest-environment jsdom
import {
  DEFAULT_AGENT_HOURS,
  REAUTHENTICATION_ERROR_CODE,
  SetAgentHoursBodySchema,
  type AgentHours,
} from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoursSection } from './HoursSection';

const confirmPassword = vi.fn<(password: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmPassword: (password: string) => confirmPassword(password),
}));

/* An invented creator: no real person. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const SPACE = ' ';

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const view = (hours: AgentHours, patch: Record<string, unknown> = {}) => ({
  hours,
  isDefault: hours === DEFAULT_AGENT_HOURS,
  invalidStored: false,
  timeZone: 'Europe/Paris',
  ...patch,
});

/** The server stores what it is sent and answers with it. */
const echo = (body: unknown) => view(SetAgentHoursBodySchema.parse(body).hours ?? DEFAULT_AGENT_HOURS);

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1/creators/:id/agent-hours`: GET answered by `get`, each PUT by `put` and kept in `put`s. */
function serve(routes: { get?: () => Reply; put?: (body: unknown) => Reply }): unknown[] {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/agent-hours`);
      const reply =
        init?.method === 'PUT'
          ? (() => {
              const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
              puts.push(body);
              return routes.put?.(body) ?? { status: 500 };
            })()
          : (routes.get?.() ?? { status: 200, body: view(DEFAULT_AGENT_HOURS) });
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
      <HoursSection creatorId={CREATOR} creatorName="Nora Vidal" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // jsdom has no matchMedia: a reduced motion, so the thumb of « À toute heure · Par créneaux » does not play.
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  confirmPassword.mockReset();
});

const save = (): HTMLElement => screen.getByRole('button', { name: 'Enregistrer' });

describe('Créatrices › Heures (P3-14)', () => {
  it('reads on her clock, and says the defaults answer at any hour', async () => {
    serve({});
    renderSection();
    expect(await screen.findByText('À l’heure de Nora (Paris)')).toBeDefined();
    expect(screen.getByText('Réglages d’origine : l’agent répond à toute heure')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'À toute heure' }).getAttribute('aria-checked')).toBe('true');
    expect(save()).toHaveProperty('disabled', true);
    // The defaults offer no way back to themselves.
    expect(screen.queryByRole('button', { name: 'Revenir aux réglages d’origine' })).toBeNull();
  });

  it('offers 9 h – 1 h every day, and saves the slots she keeps', async () => {
    const puts = serve({ put: (body) => ({ status: 200, body: echo(body) }) });
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    // A line a day, each with its slot; the words say only what the two hours do not (CREA-21).
    const list = screen.getByRole('list', { name: 'Créneaux' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).getAllByRole('group', { name: /^Créneau du /u })).toHaveLength(7);
    expect(within(list).getAllByText('jusqu’au lendemain')).toHaveLength(7);
    expect(within(list).queryByText('Actif')).toBeNull();

    // Sunday off: it stays in the list, switched off, never removed.
    fireEvent.click(screen.getByRole('switch', { name: /Activer le créneau du dimanche/u }));
    const sunday = within(list).getByRole('group', { name: /^Créneau du dimanche/u });
    expect(sunday.dataset['off']).toBe('true');
    expect(within(sunday).getByText('Coupé')).toBeDefined();

    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const sent = SetAgentHoursBodySchema.parse(puts[0]);
    expect(sent.hours?.reply).toMatchObject({ mode: 'slots' });
    expect(sent.hours?.reply.mode === 'slots' && sent.hours.reply.slots.filter((s) => !s.enabled)).toEqual([
      { day: 7, startMinute: 540, endMinute: 60, enabled: false },
    ]);
    expect(await screen.findByText('Enregistré : l’agent suit ces heures dès maintenant.')).toBeDefined();
  });

  it('marks the slot that overlaps another, and keeps the save shut', async () => {
    serve({});
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    // Tuesday from 0 h 30: Monday's 9 h – 1 h is still on.
    fireEvent.change(screen.getByLabelText('Début du créneau du mardi'), { target: { value: '00:30' } });
    expect(
      screen.getByText(`Chevauche le créneau du lundi, 9${SPACE}h${SPACE}–${SPACE}1${SPACE}h`),
    ).toBeDefined();
    expect(screen.getByText('Une ligne à corriger')).toBeDefined();
    expect(save()).toHaveProperty('disabled', true);
  });

  it('keeps a line where it is while she types, adds a slot on its own day, and sorts at the save', async () => {
    const puts = serve({ put: (body) => ({ status: 200, body: echo(body) }) });
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    // Monday holds 9 h – 1 h: « Ajouter » gives the free stretch before it, after it in the list.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un créneau le lundi' }));
    const monday = (): string[] =>
      within(screen.getByRole('list', { name: 'Créneaux' }))
        .getAllByRole('group', { name: /^Créneau du lundi/u })
        .map((group) => (group.getAttribute('aria-label') ?? '').replace(/\s/gu, ' '));
    expect(monday()).toEqual([
      'Créneau du lundi, 9 h – 1 h, jusqu’au lendemain',
      'Créneau du lundi, 1 h – 9 h',
    ]);
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    const sent = SetAgentHoursBodySchema.parse(puts[0]);
    // Saved in the order of the week: the early slot first.
    expect(sent.hours?.reply.mode === 'slots' && sent.hours.reply.slots.slice(0, 2)).toEqual([
      { day: 1, startMinute: 60, endMinute: 540, enabled: true },
      { day: 1, startMinute: 540, endMinute: 60, enabled: true },
    ]);
    await waitFor(() => {
      expect(monday()[0]).toBe('Créneau du lundi, 1 h – 9 h');
    });
  });

  it('says « Hors de ses créneaux » only by the slots', async () => {
    serve({});
    renderSection();
    await screen.findByText('À l’heure de Nora (Paris)');
    expect(screen.queryByText(/Hors de ses créneaux/u)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Par créneaux' }));
    expect(screen.getByText(/Hors de ses créneaux/u)).toBeDefined();
  });

  it('writes its hours on 24 hours in a text field, whatever the browser’s language (recette 28/10, M15)', async () => {
    serve({});
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    const start = screen.getByLabelText('Début du créneau du mardi');
    expect(start).toHaveProperty('type', 'text');
    expect(start).toHaveProperty('value', '09:00');
    fireEvent.change(start, { target: { value: '21h' } });
    // Typed by hand, kept as typed until the field is left, then written back as HH:MM.
    expect(start).toHaveProperty('value', '21h');
    expect(start.getAttribute('aria-invalid')).toBeNull();
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '21:00');
    // An hour alone is an hour.
    fireEvent.change(start, { target: { value: '22' } });
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '22:00');
    expect(save()).toHaveProperty('disabled', false);
    // What is not an hour stays as typed, marked, and the save stays shut: never another hour than the one on screen.
    fireEvent.change(start, { target: { value: '25:00' } });
    expect(start.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '25:00');
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Une heure à corriger, sur 24 heures : 22, 2230 ou 22:30')).toBeDefined();
    expect(save()).toHaveProperty('disabled', true);
    fireEvent.change(start, { target: { value: '23:00' } });
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '23:00');
    expect(save()).toHaveProperty('disabled', false);
  });

  it('warns when no follow-up could ever go out, in amber, without blocking', async () => {
    serve({});
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    for (const day of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
      fireEvent.change(screen.getByLabelText(`Début du créneau du ${day}`), { target: { value: '23:00' } });
    }
    expect(screen.getByRole('status').textContent).toBe(
      'Aucune relance ne pourra partir : chaque créneau tombe dans ses heures calmes.',
    );
    expect(save()).toHaveProperty('disabled', false);
  });

  it('goes back to the defaults by storing none', async () => {
    const hours: AgentHours = { ...DEFAULT_AGENT_HOURS, night: { startMinute: 1380, endMinute: 420 } };
    const puts = serve({
      get: () => ({ status: 200, body: view(hours) }),
      put: () => ({ status: 200, body: view(DEFAULT_AGENT_HOURS) }),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Revenir aux réglages d’origine' }));
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toEqual([{ hours: null }]);
    });
  });

  it('says a stored setting that no longer reads, and replaces it on save', async () => {
    const puts = serve({
      get: () => ({ status: 200, body: view(DEFAULT_AGENT_HOURS, { invalidStored: true }) }),
      put: () => ({ status: 200, body: view(DEFAULT_AGENT_HOURS) }),
    });
    renderSection();
    expect(
      await screen.findByText(
        'Son réglage enregistré ne se lit plus : l’agent suit les réglages d’origine. Enregistre pour le remplacer.',
      ),
    ).toBeDefined();
    fireEvent.click(save());
    await waitFor(() => {
      expect(puts).toEqual([{ hours: null }]);
    });
  });

  it('asks for the password when the sign-in is old, then saves', async () => {
    let fresh = false;
    const puts = serve({
      put: (body) =>
        fresh
          ? { status: 200, body: echo(body) }
          : { status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) },
    });
    confirmPassword.mockImplementation(() => {
      fresh = true;
      return Promise.resolve('ok');
    });
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    fireEvent.click(save());
    expect(await screen.findByText('Pour changer ses heures, confirme ton mot de passe.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'staple battery horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => {
      expect(puts).toHaveLength(2);
    });
    expect(await screen.findByText('Enregistré : l’agent suit ces heures dès maintenant.')).toBeDefined();
  });

  it('says the server does not answer, and offers to try again', async () => {
    let fails = true;
    serve({ get: () => (fails ? { status: 503 } : { status: 200, body: view(DEFAULT_AGENT_HOURS) }) });
    renderSection();
    expect(await screen.findByText('Le serveur ne répond pas. Réessaie dans un instant.')).toBeDefined();
    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('À l’heure de Nora (Paris)')).toBeDefined();
  });

  it('keeps a failed save as it was, with the reason in words', async () => {
    serve({ put: () => ({ status: 500 }) });
    renderSection();
    fireEvent.click(await screen.findByRole('radio', { name: 'Par créneaux' }));
    fireEvent.click(save());
    expect(await screen.findByText('Le serveur ne répond pas. Réessaie dans un instant.')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Par créneaux' }).getAttribute('aria-checked')).toBe('true');
  });

  it('reads her hours on her new clock once the owner moves her, and keeps them as they were', async () => {
    const slots: AgentHours = {
      ...DEFAULT_AGENT_HOURS,
      reply: { mode: 'slots', slots: [{ day: 1, startMinute: 540, endMinute: 1080, enabled: true }] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const body =
          init?.method === 'PATCH'
            ? { id: CREATOR, displayName: 'Nora Vidal', timezone: 'America/New_York' }
            : view(slots, { isDefault: false });
        expect(url).toBe(
          init?.method === 'PATCH' ? `/v1/creators/${CREATOR}` : `/v1/creators/${CREATOR}/agent-hours`,
        );
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    renderSection();
    expect(await screen.findByText('À l’heure de Nora (Paris)')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Changer de fuseau' }));
    fireEvent.change(screen.getByLabelText('Fuseau'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le fuseau' }));
    expect(await screen.findByText('À l’heure de Nora (New York)')).toBeDefined();
    // Her hours are not touched: nothing to save, her slot as it was.
    expect(save()).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Début du créneau du lundi')).toHaveProperty('value', '09:00');
  });
});
