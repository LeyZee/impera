// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdeasSection } from './IdeasSection';

/* An invented creator, ideas and trends. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const SIGNAL = {
  id: '0192f3a0-0000-7000-8000-000000000401',
  creatorId: CREATOR,
  source: 'agency_link',
  kind: 'format',
  text: 'Transitions miroir sur un son qui monte',
  url: 'https://www.instagram.com/reel/AbCdEf123/',
  format: 'reel',
  metrics: { views: 12_300, likes: 840, comments: null },
  observedAt: '2026-11-06T06:00:00.000Z',
  expiresAt: '2026-11-09T12:00:00.000Z',
};
const PROPOSED = {
  id: '0192f3a0-0000-7000-8000-000000000301',
  creatorId: CREATOR,
  state: 'proposed',
  proposedOn: '2026-11-06',
  refusalReason: null,
  title: 'Transition miroir',
  category: 'feed_video',
  toShoot: 'Un plan face au miroir, puis la même tenue en extérieur.',
  signalId: SIGNAL.id,
  reason: 'Le format monte cette semaine.',
  shootMinutes: 20,
  signal: SIGNAL,
};
const REFUSED = {
  ...PROPOSED,
  id: '0192f3a0-0000-7000-8000-000000000302',
  state: 'refused',
  title: 'Story du matin',
  refusalReason: 'Déjà tourné',
};
const SUGGESTION = {
  id: '0192f3a0-0000-7000-8000-000000000201',
  week: '2026-11-02',
  when: null,
  minutes: 20,
  category: 'shoot',
  title: 'Transition miroir',
  purpose: null,
  shootBrief: null,
  essential: false,
  origin: 'agency',
  state: 'suggested',
  reason: null,
  decidedAt: null,
  createdAt: '2026-11-06T09:00:00.000Z',
  task: null,
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
const apiError = (code: string, message = code): unknown => ({
  error: { code, message, details: {}, requestId: 'r1' },
});

/** A fake `/v1`: each `METHOD path` (query left out) answered by its route, every call kept. */
function serve(routes: Record<string, () => Reply>): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '').replace(/\?.*$/u, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const reply = routes[`${method} ${path}`]?.() ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const IDEAS = `GET /creators/${CREATOR}/ideas`;
const list = (items: readonly unknown[]) => (): Reply => ({
  status: 200,
  body: { day: '2026-11-06', items },
});

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <IdeasSection creatorId={CREATOR} creatorName="Lina" timezone="Europe/Paris" />
    </QueryClientProvider>,
  );
}

async function card(title: string): Promise<HTMLElement> {
  return screen.findByRole('listitem', { name: title });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Idées du jour', () => {
  it('shows each idea with the trend it cites, and what waits for a decision', async () => {
    serve({ [IDEAS]: list([PROPOSED, REFUSED]) });
    show();
    const proposed = await card('Transition miroir');
    expect(screen.getByText('2 idées · 1 à décider')).toBeTruthy();
    expect(proposed.textContent).toContain('À décider');
    expect(proposed.textContent).toContain('≈ 20 min');
    const signal = within(proposed).getByRole('region', { name: 'Tendance citée' });
    expect(signal.textContent).toContain('Lien collé par l’agence');
    expect(signal.textContent).toContain('jusqu’au 09/11/2026');
    expect(within(signal).getByRole('link', { name: 'Voir sur Instagram' }).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    const refused = await card('Story du matin');
    expect(refused.textContent).toContain('Motif : Déjà tourné');
    expect(within(refused).queryByRole('button', { name: 'Valider' })).toBeNull();
  });

  it('says when there is no idea, and never offers a day after today', async () => {
    serve({ [IDEAS]: list([]) });
    show();
    expect(await screen.findByText('Pas d’idée aujourd’hui')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jour suivant' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Jour précédent' }));
    expect(await screen.findByText('Pas d’idée ce jour-là')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aujourd’hui' })).toBeTruthy();
  });

  it('validates an idea as it is', async () => {
    const calls = serve({
      [IDEAS]: list([PROPOSED]),
      [`POST /creators/${CREATOR}/ideas/${PROPOSED.id}/validate`]: () => ({
        status: 200,
        body: { idea: { ...PROPOSED, state: 'suggested', signal: undefined }, suggestion: SUGGESTION },
      }),
    });
    show();
    fireEvent.click(within(await card('Transition miroir')).getByRole('button', { name: 'Valider' }));
    expect((await screen.findByRole('status')).textContent).toContain('elle la placera elle-même');
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ correction: null });
  });

  it('sends only what was corrected, and says the guard that refused it', async () => {
    const calls = serve({
      [IDEAS]: list([PROPOSED]),
      [`POST /creators/${CREATOR}/ideas/${PROPOSED.id}/validate`]: () => ({
        status: 422,
        body: apiError('content_idea_guard_unprocessable', 'Cette idée touche une de ses limites'),
      }),
    });
    show();
    const item = await card('Transition miroir');
    fireEvent.click(within(item).getByRole('button', { name: 'Corriger' }));
    fireEvent.change(within(item).getByLabelText('Titre'), { target: { value: '' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Valider avec ces corrections' }));
    expect(within(item).getByText('Donne-lui un titre.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    fireEvent.change(within(item).getByLabelText('Titre'), { target: { value: 'Miroir, version nuit' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Valider avec ces corrections' }));
    expect(await within(item).findByText('Cette idée touche une de ses limites.')).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      correction: { title: 'Miroir, version nuit' },
    });
  });

  it('writes a reel sheet for a Reel Insta idea, and names the field a guard refused (VEI-08)', async () => {
    const reel = { ...PROPOSED, category: 'instagram_reel' };
    const calls = serve({
      [IDEAS]: list([reel]),
      [`POST /creators/${CREATOR}/ideas/${PROPOSED.id}/validate`]: () => ({
        status: 422,
        body: {
          error: {
            code: 'content_idea_guard_unprocessable',
            message: 'Cette idée enfreint la garde Instagram : corrige-la ou refuse-la',
            details: { reason: 'instagram_guard', field: 'hook' },
            requestId: 'r1',
          },
        },
      }),
    });
    show();
    const item = await card('Transition miroir');
    fireEvent.click(within(item).getByRole('button', { name: 'Corriger' }));
    fireEvent.change(within(item).getByLabelText(/Première phrase/u), {
      target: { value: 'Devine ce que je prépare' },
    });
    fireEvent.change(within(item).getByLabelText('Plan 1'), { target: { value: 'Reflet dans le miroir' } });
    fireEvent.change(within(item).getByLabelText('Plan 2'), { target: { value: 'Tenue de soirée' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Valider avec ces corrections' }));
    expect(
      await within(item).findByText(
        'Cette idée enfreint la garde Instagram : corrige-la ou refuse-la (Première phrase).',
      ),
    ).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      correction: {
        reelBrief: {
          hook: 'Devine ce que je prépare',
          onScreen: null,
          shots: ['Reflet dans le miroir', 'Tenue de soirée'],
          ending: null,
          seconds: 20,
        },
      },
    });
  });

  it('refuses an idea with an optional reason', async () => {
    const calls = serve({
      [IDEAS]: list([PROPOSED]),
      [`POST /creators/${CREATOR}/ideas/${PROPOSED.id}/refuse`]: () => ({
        status: 200,
        body: { ...PROPOSED, state: 'refused', signal: undefined, refusalReason: 'Pas son style' },
      }),
    });
    show();
    const item = await card('Transition miroir');
    fireEvent.click(within(item).getByRole('button', { name: 'Refuser' }));
    fireEvent.change(within(item).getByLabelText('Motif (facultatif)'), {
      target: { value: ' Pas son style ' },
    });
    fireEvent.click(within(item).getByRole('button', { name: 'Refuser l’idée' }));
    expect(await within(item).findByText('Refusée : elle ne sera jamais reproposée.')).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ reason: 'Pas son style' });
  });

  it('pastes a link only once it reads as an Instagram post', async () => {
    const calls = serve({
      [IDEAS]: list([]),
      'POST /trends/links': () => ({
        status: 201,
        body: {
          created: true,
          url: 'https://www.instagram.com/reel/AbCdEf123/',
          expiresAt: '2026-11-13T12:00:00.000Z',
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Coller un lien' }));
    const form = screen.getByRole('form', { name: 'Coller un lien' });
    fireEvent.change(within(form).getByLabelText('Lien du post'), {
      target: { value: 'https://example.org/x' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ajouter' }));
    expect(within(form).getByText('Ce n’est pas l’adresse d’un post ou d’un reel Instagram.')).toBeTruthy();
    expect(within(form).getByText('Choisis son format.')).toBeTruthy();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText('Lien du post'), {
      target: { value: 'https://www.instagram.com/reel/AbCdEf123/?igsh=xyz' },
    });
    fireEvent.change(within(form).getByLabelText('Ce qu’il montre'), {
      target: { value: 'Transition miroir' },
    });
    fireEvent.click(within(form).getByRole('radio', { name: 'Reel' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Ajouter' }));
    expect((await within(form).findByRole('status')).textContent).toBe(
      'Ajouté aux tendances de Lina, jusqu’au 13/11/2026. Les idées du matin pourront le citer.',
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      url: 'https://www.instagram.com/reel/AbCdEf123/',
      text: 'Transition miroir',
      format: 'reel',
      creatorId: CREATOR,
    });
  });
});
