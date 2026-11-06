// @vitest-environment jsdom
import {
  CONTENT_REQUEST_DUE_UNPROCESSABLE,
  CreateContentRequestBodySchema,
  CreatorIdSchema,
  SetScriptCadenceBodySchema,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestsSection } from './RequestsSection';

import { structureOf } from '@/creators/scripts/fixtures';
import { requestOf } from '@/screens/content/fixtures';

/* An invented creator, structure and requests (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const NIGHT = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');
const OPEN = requestOf({ dueOn: '2026-11-09', reason: 'Une séance en lingerie noire pour le feed' });
const REFUSED = requestOf({
  state: 'refused',
  refusalReason: 'Pas ce week-end',
  reason: 'Une vidéo à la plage',
});
const CADENCE = {
  creatorId: CREATOR,
  days: 7,
  lastDueOn: '2026-11-03',
  outcome: 'queue_empty',
  skipped: [],
  checkedAt: '2026-11-03T05:00:00.000Z',
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A fake `/v1`: each `METHOD path` answered by its route, every call kept. */
function serve(routes: Record<string, (body: unknown) => Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const CONTENT = `GET /creators/${CREATOR}/content`;
const STRUCTURES = 'GET /script-structures';
const GET_CADENCE = `GET /creators/${CREATOR}/script-cadence`;
const PUT_CADENCE = `PUT /creators/${CREATOR}/script-cadence`;
const ASK = `POST /creators/${CREATOR}/content-requests`;

const base = (): Record<string, (body: unknown) => Reply> => ({
  [CONTENT]: () => ({ status: 200, body: { requests: [OPEN, REFUSED], drops: [] } }),
  [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
  [GET_CADENCE]: () => ({ status: 200, body: CADENCE }),
});

function show(isOwner = true): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RequestsSection creatorId={CREATOR} creatorName="Lina" timezone="Europe/Paris" isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // 06/11/2026, a Friday, in Paris: the days the screen says are counted from it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T10:00:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Créatrices › Demandes (MED-09)', () => {
  it('lists what is under way, then what she refused with her reason', async () => {
    serve(base());
    show();
    const open = await screen.findByRole('region', { name: 'En cours' });
    const card = within(open).getByRole('listitem');
    expect(within(card).getByText('Pour lundi')).toBeDefined();
    expect(within(card).getByText('À faire')).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Annuler la demande' })).toBeDefined();
    const closed = screen.getByRole('region', { name: 'Refusées ou annulées' });
    expect(within(closed).getByText('Sa raison : Pas ce week-end')).toBeDefined();
    expect(within(closed).queryByRole('button', { name: 'Annuler la demande' })).toBeNull();
  });

  it('says the cadence and what it last did, and lets the owner change it', async () => {
    const calls = serve({
      ...base(),
      [PUT_CADENCE]: (body) => ({
        status: 200,
        body: { ...CADENCE, ...SetScriptCadenceBodySchema.parse(body) },
      }),
    });
    show();
    expect(await screen.findByText('Tous les 7 jours · le dernier pour le 3 nov.')).toBeDefined();
    expect(
      screen.getByText('Aucune structure dans sa file : aucun script n’a été demandé.').dataset['tone'],
    ).toBe('warn');
    const days = screen.getByLabelText('Un script tous les');
    fireEvent.change(days, { target: { value: '0' } });
    expect(screen.getByText('De 1 à 90 jours.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    fireEvent.change(days, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Tous les 10 jours · le dernier pour le 3 nov.')).toBeDefined();
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ days: 10 });
  });

  it('lets a manager read the cadence, never change it', async () => {
    serve(base());
    show(false);
    expect(await screen.findByText('Tous les 7 jours · le dernier pour le 3 nov.')).toBeDefined();
    expect(screen.queryByLabelText('Un script tous les')).toBeNull();
  });

  it('asks a content: refused until each field is right, then sent once', async () => {
    const calls = serve({
      ...base(),
      [ASK]: (body) => ({ status: 200, body: requestOf(CreateContentRequestBodySchema.parse(body)) }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un contenu' }));
    const dialog = screen.getByRole('dialog', { name: 'Demander un contenu' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Demander' }));
    expect(within(dialog).getByText('Choisis ce que tu lui demandes.')).toBeDefined();
    expect(within(dialog).getByText('Dis-lui en une phrase ce que tu attends.')).toBeDefined();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    fireEvent.click(within(dialog).getByRole('radio', { name: /Vidéo short/u }));
    fireEvent.change(within(dialog).getByLabelText('Pourquoi'), {
      target: { value: '  Un clip pour vendredi  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Pour le'), { target: { value: '12/11/2026' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Demander' }));
    expect(await screen.findByText('Demandé : Lina le voit dans son Contenu.')).toBeDefined();
    const posted = calls.find((call) => call.method === 'POST');
    expect(posted?.body).toMatchObject({
      category: 'feed_video',
      dueOn: '2026-11-12',
      reason: 'Un clip pour vendredi',
      structureId: null,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks a script’s structure, and says the moment is fixed for her', async () => {
    serve(base());
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un contenu' }));
    const dialog = screen.getByRole('dialog', { name: 'Demander un contenu' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Script/u }));
    expect(
      within(dialog).getByText('Jour ou Nuit se fixe tout seul : l’autre moment que son dernier script.'),
    ).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Pourquoi'), {
      target: { value: 'Le script de la semaine' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Demander' }));
    expect(within(dialog).getByText('Choisis la structure du script.')).toBeDefined();
  });

  it('puts the server’s refusal of a past day under the day (MED-10)', async () => {
    serve({
      ...base(),
      [ASK]: () => ({
        status: 422,
        body: {
          error: {
            code: CONTENT_REQUEST_DUE_UNPROCESSABLE,
            message: 'Ce jour est déjà passé pour elle',
            details: {},
            requestId: 'req-1',
          },
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un contenu' }));
    const dialog = screen.getByRole('dialog', { name: 'Demander un contenu' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Séance boudoir/u }));
    fireEvent.change(within(dialog).getByLabelText('Pourquoi'), { target: { value: 'Une séance' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Demander' }));
    expect(await within(dialog).findByText('Ce jour est déjà passé pour elle.')).toBeDefined();
    expect(within(dialog).getByLabelText('Pour le').getAttribute('aria-invalid')).toBe('true');
  });

  it('cancels a request she has not begun, after asking', async () => {
    const calls = serve({
      ...base(),
      [`DELETE /creators/${CREATOR}/content-requests/${OPEN.id}`]: () => ({ status: 204 }),
    });
    show();
    const open = await screen.findByRole('region', { name: 'En cours' });
    fireEvent.click(within(open).getByRole('button', { name: 'Annuler la demande' }));
    const dialog = screen.getByRole('dialog', { name: 'Annuler cette demande ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler la demande' }));
    expect(await screen.findByText('Demande annulée : elle ne la voit plus.')).toBeDefined();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });
});
