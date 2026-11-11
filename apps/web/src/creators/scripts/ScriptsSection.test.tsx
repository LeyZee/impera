// @vitest-environment jsdom
import { CreatorIdSchema, type DropDescriptionsReview } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScriptsSection } from './ScriptsSection';
import { reviewOf, structureOf } from './fixtures';

import { dropOf, fileOf, requestOf } from '@/screens/content/fixtures';
import { startMediaBlur } from '@/shell/media-blur';

/* An invented creator, structure and scripts (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const NIGHT = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');
const REQUEST = requestOf({ category: 'script', structureId: NIGHT.id, moment: 'night' });
const SENT = dropOf({
  category: 'script',
  scriptNumber: 12,
  requestId: REQUEST.id,
  files: [fileOf({ slotKey: 'salon::0' })],
});
const COPIED = { ...SENT, exportedAt: '2026-11-06T15:00:00.000Z' };

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake `/v1`: each `METHOD path` answered by its route, every call kept. */
function serve(routes: Record<string, (body: unknown) => Reply>): { method: string; path: string }[] {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      calls.push({ method, path });
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
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
const CONFIRM = `POST /creators/${CREATOR}/drops/${SENT.id}/script-export/confirm`;

function show(isOwner = false): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScriptsSection creatorId={CREATOR} creatorName="Lina" timezone="Europe/Paris" isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Scripts (SC-03 c2b)', () => {
  it('shows a sent script by its number and moment, with its archive to download', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Soirée inventée' });
    expect(within(card).getByText('S012')).toBeDefined();
    expect(within(card).getByText('Nuit')).toBeDefined();
    expect(within(card).getByText('À recopier')).toBeDefined();
    expect(within(card).getByRole('link', { name: 'Télécharger l’archive' }).getAttribute('href')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/script-export`,
    );
    expect(screen.getByText('1 script · 1 à recopier')).toBeDefined();
  });

  it('counts « à recopier » only what can be copied now, and gives the neon to the next one alone', async () => {
    const next = { ...SENT, id: '0192f3a0-0000-7000-8000-000000000d02', scriptNumber: 13 };
    const checking = {
      ...SENT,
      id: '0192f3a0-0000-7000-8000-000000000d03',
      scriptNumber: 14,
      state: 'received',
    };
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT, next, checking] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
    });
    show();
    expect(await screen.findByText('3 scripts · 2 à recopier')).toBeDefined();
    const confirms = screen.getAllByRole('button', { name: 'Copié dans Reveal' });
    expect(confirms.map((button) => button.classList.contains('nv-btn--neon'))).toEqual([true, false]);
  });

  it('confirms the copy behind a dialog, then reads it copied with the date her originals go', async () => {
    let copied = false;
    const calls = serve({
      [CONTENT]: () => ({
        status: 200,
        body: { requests: [REQUEST], drops: [copied ? COPIED : SENT] },
      }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
      [CONFIRM]: () => {
        copied = true;
        return { status: 200, body: COPIED };
      },
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Soirée inventée' });
    fireEvent.click(within(card).getByRole('button', { name: 'Copié dans Reveal' }));
    const dialog = screen.getByRole('dialog', { name: 'Copié dans Reveal ?' });
    expect(within(dialog).getByText(/partent alors dans 30 jours/u)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer la copie' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      await screen.findByText('Copié le 6 novembre. Ses originaux partent au plus tard le 6 décembre.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Copié dans Reveal' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('says the server’s refusal in the dialog, and keeps it open', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
      [CONFIRM]: () => ({
        status: 422,
        body: {
          error: {
            code: 'content_drop_export_unprocessable',
            message: 'Un original de ce script est déjà effacé',
            details: { reason: 'original_erased' },
            requestId: 'r1',
          },
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Copié dans Reveal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la copie' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Un original de ce script est déjà effacé.');
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('offers no archive for a « Jour et nuit » script asked before its moment was fixed', async () => {
    const both = structureOf('0192f3a0-0000-7000-8000-000000000a02', 'Week-end inventé', 'both');
    const request = { ...REQUEST, structureId: both.id, moment: null };
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [request], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [both] } }),
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Week-end inventé' });
    expect(within(card).getByText('Archive impossible')).toBeDefined();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('says when she has sent none yet, and when her content does not load', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [] } }),
    });
    show();
    expect(await screen.findByText('Aucun script envoyé')).toBeDefined();
    cleanup();
    serve({});
    show();
    expect(await screen.findByText('Ses scripts ne se chargent pas')).toBeDefined();
  });
});

describe('Créatrices › Scripts, les descriptions (SC-04 lot c3)', () => {
  const SWITCH = `/creators/${CREATOR}/drop-descriptions`;
  const REVIEW = `/creators/${CREATOR}/drops/${SENT.id}/descriptions`;
  const FILES = [
    '0192f3a0-0000-7000-8000-000000000b01',
    '0192f3a0-0000-7000-8000-000000000b02',
    '0192f3a0-0000-7000-8000-000000000b03',
  ] as const;
  const base = {
    [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT] } }),
    [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
  };

  it('gives the owner alone her switch; turned on, it says so', async () => {
    let on = false;
    const calls = serve({
      ...base,
      [`GET ${SWITCH}`]: () => ({ status: 200, body: { on } }),
      [`PUT ${SWITCH}`]: () => {
        on = true;
        return { status: 200, body: { on } };
      },
    });
    show(true);
    const toggle = await screen.findByRole('switch', { name: 'Descriptions par l’IA' });
    if (!(toggle instanceof HTMLInputElement)) throw new Error('the switch is an input');
    await waitFor(() => {
      expect(toggle.disabled).toBe(false);
    });
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/Éteint : ses médias ne sont pas décrits/u)).toBeDefined();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
    expect(screen.getByText(/Chaque photo et vidéo de Lina est décrite/u)).toBeDefined();
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    cleanup();
    const asManager = serve(base);
    show(false);
    await screen.findByRole('listitem', { name: 'Soirée inventée' });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(asManager.some((call) => call.path === SWITCH)).toBe(false);
  });

  it('reads a script step by step, the synthesis with « prix à fixer », and validates a step at once', async () => {
    let validated = false;
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({
        status: 200,
        body: reviewOf(SENT.id, FILES, { reasons: [[], ['unsure'], ['flagged']], summary: 'price' }),
      }),
      [`POST /creators/${CREATOR}/drops/${SENT.id}/descriptions/validate`]: () => {
        validated = true;
        return {
          status: 200,
          body: reviewOf(SENT.id, FILES, {
            reasons: [[], ['unsure'], ['flagged']],
            validated: [true, false, false],
            summary: 'price',
          }),
        };
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    expect(within(region).getByText('3 descriptions à valider')).toBeDefined();
    // E1 offered, as its card says: no price to fix; E2A and E2B paid, their price from the grid.
    expect(within(region).getAllByText('Prix à fixer')).toHaveLength(2);
    expect(within(region).getByText('Offert')).toBeDefined();
    expect(within(region).getByText(/Elle cite un montant/u)).toBeDefined();
    expect(within(region).getByText('Son ressenti : Ma préférée')).toBeDefined();
    expect(within(region).getByText('L’IA n’est pas sûre')).toBeDefined();
    expect(within(region).getByText('Alerte de sécurité')).toBeDefined();
    // Held back by the code: never under « Tout valider », validated alone.
    expect(within(region).getAllByRole('button', { name: 'Tout valider' })).toHaveLength(1);
    expect(within(region).getAllByRole('button', { name: 'Valider celle-ci' })).toHaveLength(2);
    fireEvent.click(within(region).getByRole('button', { name: 'Tout valider' }));
    expect(await within(region).findByText('2 descriptions à valider')).toBeDefined();
    expect(validated).toBe(true);
    expect(within(region).queryByRole('button', { name: 'Tout valider' })).toBeNull();
  });

  it('shows each medium’s picture, blurred, and opens it in large beside its description (SC-04 lot c4)', async () => {
    window.localStorage.clear();
    startMediaBlur();
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({ status: 200, body: reviewOf(SENT.id, FILES, { thumbnails: true }) }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    const opens = within(region).getAllByRole('button', { name: 'Voir la photo en grand' });
    expect(opens).toHaveLength(3);
    expect(opens[0]?.querySelector('img')?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/files/${FILES[0]}/thumbnail`,
    );
    expect(document.documentElement.dataset['mediaBlur']).toBe('on');

    fireEvent.click(opens[1] ?? region);
    const viewer = await screen.findByRole('dialog', { name: 'Photo · E2A' });
    const picture = viewer.querySelector('img.sx-viewer__media');
    expect(picture?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/files/${FILES[1]}/media`,
    );
    expect(picture?.getAttribute('data-revealed')).toBe('false');
    expect(within(viewer).getByText('Photo inventée 2 : une silhouette près d’une fenêtre.')).toBeDefined();
    expect(within(viewer).getByRole('button', { name: 'Corriger' })).toBeDefined();
    // « Voir net » shows this one alone, the switch stays as it is.
    fireEvent.click(within(viewer).getByRole('button', { name: 'Voir net' }));
    expect(picture?.getAttribute('data-revealed')).toBe('true');
    expect(document.documentElement.dataset['mediaBlur']).toBe('on');
  });

  it('plays a video without its controls while it is blurred, and with them once « Voir net » (SC-04 lot c4)', async () => {
    window.localStorage.clear();
    startMediaBlur();
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({
        status: 200,
        body: reviewOf(SENT.id, FILES, { thumbnails: true, video: true }),
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    fireEvent.click(within(region).getByRole('button', { name: 'Voir la vidéo en grand' }));
    const viewer = await screen.findByRole('dialog', { name: 'Vidéo · E2B' });
    const video = viewer.querySelector('video.sx-viewer__media');
    expect(video?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/files/${FILES[2]}/media`,
    );
    expect(video?.hasAttribute('controls')).toBe(false);
    fireEvent.click(within(viewer).getByRole('button', { name: 'Voir net' }));
    expect(viewer.querySelector('video.sx-viewer__media')?.hasAttribute('controls')).toBe(true);
  });

  it('shows its picture alone once the original is erased', async () => {
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({
        status: 200,
        body: reviewOf(SENT.id, FILES, { thumbnails: true, original: false }),
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    fireEvent.click(within(region).getAllByRole('button', { name: 'Voir la photo en grand' })[0] ?? region);
    const viewer = await screen.findByRole('dialog', { name: 'Photo · E1' });
    expect(viewer.querySelector('img.sx-viewer__media')?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/files/${FILES[0]}/thumbnail`,
    );
    expect(within(viewer).getByText(/l’original est effacé/u)).toBeDefined();
  });

  it('corrects a description inline, and says the server’s refusal when a newer one came', async () => {
    let tries = 0;
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({ status: 200, body: reviewOf(SENT.id, FILES) }),
      [`POST /creators/${CREATOR}/drops/${SENT.id}/descriptions/correct`]: () => {
        tries += 1;
        if (tries === 1)
          return {
            status: 409,
            body: {
              error: {
                code: 'drop_description_review_conflict',
                message: 'Une description plus récente est arrivée entre-temps : recharge le script',
                details: { reason: 'not_shown' },
                requestId: 'r1',
              },
            },
          };
        const fixed = reviewOf(SENT.id, FILES);
        return {
          status: 200,
          body: {
            ...fixed,
            media: fixed.media.map((one, index) =>
              index === 0 && one.description !== null
                ? {
                    ...one,
                    description: {
                      ...one.description,
                      author: 'human',
                      detailed: 'Une silhouette inventée, assise.',
                      validatedAt: '2026-11-08T21:00:00.000Z',
                    },
                  }
                : one,
            ),
          },
        };
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    fireEvent.click(within(region).getAllByRole('button', { name: 'Corriger' })[0]!);
    const area = within(region).getByRole('textbox', { name: 'Ce que montre le média' });
    fireEvent.change(area, { target: { value: 'Une silhouette inventée, assise.' } });
    fireEvent.click(within(region).getByRole('button', { name: 'Enregistrer et valider' }));
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Une description plus récente est arrivée entre-temps : recharge le script.',
    );
    fireEvent.click(within(region).getByRole('button', { name: 'Enregistrer et valider' }));
    expect(await within(region).findByText('Une silhouette inventée, assise.')).toBeDefined();
    expect(within(region).getByText('Corrigée')).toBeDefined();
    expect(within(region).queryByRole('textbox')).toBeNull();
  });
  it('asks the AI again on a medium it gave up, or takes it written by hand with its level (recette créatrice 2)', async () => {
    const given = (): DropDescriptionsReview => {
      const one = reviewOf(SENT.id, FILES, { validated: [false, true, true] });
      return {
        ...one,
        media: one.media.map((medium, index) =>
          index === 0 ? { ...medium, description: null, describeFailed: true } : medium,
        ),
      };
    };
    const sent: unknown[] = [];
    const calls = serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({ status: 200, body: given() }),
      [`POST /creators/${CREATOR}/drops/${SENT.id}/files/${FILES[0]}/describe`]: () => ({
        status: 200,
        body: given(),
      }),
      [`POST /creators/${CREATOR}/drops/${SENT.id}/files/${FILES[0]}/description`]: (body) => {
        sent.push(body);
        const one = reviewOf(SENT.id, FILES, { validated: [true, true, true] });
        return {
          status: 200,
          body: {
            ...one,
            media: one.media.map((medium, index) =>
              index === 0 && medium.description !== null
                ? {
                    ...medium,
                    description: { ...medium.description, author: 'hand', detailed: 'Assise, inventée.' },
                  }
                : medium,
            ),
          },
        };
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    expect(within(region).getByText('L’IA n’a pas pu décrire 1 média : à toi de le relancer')).toBeDefined();
    expect(within(region).getByText(/Elle ne réessaie plus d’elle-même/u)).toBeDefined();
    fireEvent.click(within(region).getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => {
      expect(calls.some((call) => call.path.endsWith('/describe'))).toBe(true);
    });

    fireEvent.click(within(region).getByRole('button', { name: 'Décrire à la main' }));
    const save = within(region).getByRole('button', { name: 'Enregistrer et valider' });
    if (!(save instanceof HTMLButtonElement)) throw new Error('a button');
    fireEvent.change(within(region).getByRole('textbox', { name: 'Ce que montre la photo' }), {
      target: { value: ' Assise, inventée. ' },
    });
    // Its level is asked too: never guessed.
    expect(save.disabled).toBe(true);
    fireEvent.click(within(region).getByRole('radio', { name: 'Suggestif' }));
    expect(save.disabled).toBe(false);
    expect(within(region).getByText(/sera marqué « non vu »/u)).toBeDefined();
    fireEvent.click(save);
    expect(await within(region).findByText('Assise, inventée.')).toBeDefined();
    expect(sent).toEqual([{ detailed: 'Assise, inventée.', intensity: 'suggestive' }]);
    expect(within(region).getByText('Écrite à la main')).toBeDefined();
    expect(within(region).queryByRole('textbox')).toBeNull();
    expect(within(region).getByText('La synthèse s’écrit')).toBeDefined();
  });

  it('corrects the synthesis by hand, step by step, and says why the server refuses a price (SC-04 lot c5)', async () => {
    const sent: unknown[] = [];
    serve({
      ...base,
      [`GET ${REVIEW}`]: () => ({ status: 200, body: reviewOf(SENT.id, FILES, { summary: 'current' }) }),
      [`POST /creators/${CREATOR}/drops/${SENT.id}/summary/correct`]: (body) => {
        sent.push(body);
        if (sent.length === 1)
          return {
            status: 422,
            body: {
              error: {
                code: 'script_summary_correction_unprocessable',
                message: 'Pas de prix dans la synthèse : il vient de la grille de l’agence',
                details: { reason: 'price' },
                requestId: 'r1',
              },
            },
          };
        const fixed = reviewOf(SENT.id, FILES, { summary: 'human' });
        return {
          status: 200,
          body: {
            ...fixed,
            summary:
              fixed.summary === null
                ? null
                : {
                    ...fixed.summary,
                    content: { ...fixed.summary.content, shootingContext: 'Un soir repris.' },
                  },
          },
        };
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de S012' });
    const synthesis = within(region).getByRole('region', { name: 'Synthèse du script' });
    fireEvent.click(within(synthesis).getByRole('button', { name: 'Corriger' }));
    // Its context, then each step's line and its unfolding, as the brain told them.
    expect(within(synthesis).getAllByRole('textbox')).toHaveLength(7);
    expect(within(synthesis).getAllByRole('textbox', { name: 'En une ligne' })[1]).toHaveProperty(
      'value',
      'Résumé inventé 2.',
    );
    fireEvent.change(within(synthesis).getByRole('textbox', { name: 'Le tournage' }), {
      target: { value: '  Un soir repris.  ' },
    });
    fireEvent.change(within(synthesis).getAllByRole('textbox', { name: 'En une ligne' })[0]!, {
      target: { value: '' },
    });
    // A text left empty: nothing to save.
    expect(within(synthesis).getByRole('button', { name: 'Enregistrer et valider' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(within(synthesis).getAllByRole('textbox', { name: 'En une ligne' })[0]!, {
      target: { value: 'Le bundle à 25 €.' },
    });
    fireEvent.click(within(synthesis).getByRole('button', { name: 'Enregistrer et valider' }));
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Pas de prix dans la synthèse : il vient de la grille de l’agence.',
    );
    expect(sent[0]).toMatchObject({
      summaryId: '0192f3a0-0000-7000-8000-00000000c001',
      shootingContext: 'Un soir repris.',
    });
    fireEvent.change(within(synthesis).getAllByRole('textbox', { name: 'En une ligne' })[0]!, {
      target: { value: 'Le salon, repris.' },
    });
    fireEvent.click(within(synthesis).getByRole('button', { name: 'Enregistrer et valider' }));
    expect(await within(region).findByText('Corrigée à la main')).toBeDefined();
    expect(within(region).getByText('Un soir repris.')).toBeDefined();
    expect(within(region).queryByRole('textbox')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Valider la synthèse' })).toBeNull();
  });
});
