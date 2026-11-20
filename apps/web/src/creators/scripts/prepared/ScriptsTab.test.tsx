// @vitest-environment jsdom
import { CreatePreparedScriptBodySchema, SavePreparedScriptBodySchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAVE_AFTER_MS } from './PreparedEditor';
import { PreparedScriptsView } from './PreparedScriptsView';
import { ScriptsTab } from './ScriptsTab';
import { ScriptsToCopyView } from './ScriptsToCopyView';
import { CHOICES, CONTENT, CREATOR, SCRIPT, VAULT, viewOf } from './fixtures';

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake `/v1`: each `METHOD path` answered by its route, every call kept with its body. */
function serve(
  routes: Record<string, (body: unknown) => Reply>,
): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
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

const BASE = `/creators/${CREATOR}/prepared-scripts`;
const vaultRoutes = {
  [`GET /creators/${CREATOR}/vault`]: () => ({ status: 200, body: VAULT }),
  [`GET /creators/${CREATOR}/vault/choices`]: () => ({ status: 200, body: CHOICES }),
};

function show(
  screenOf: JSX.Element = <ScriptsTab creatorId={CREATOR} creatorName="Lina" sent={<p>Scripts envoyés</p>} />,
): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {screenOf}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Créatrices › Scripts › Scripts (SCB-04 lot 3)', () => {
  it('lists her scripts in preparation with where each stands', async () => {
    serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({
        status: 200,
        body: [viewOf({ gaps: [{ code: 'media_missing', step: 0, branch: null, term: null }] })],
      }),
    });
    show();
    const row = await screen.findByRole('button', { name: /Soirée inventée/u });
    expect(within(row).getByText('1 manque')).toBeDefined();
    expect(within(row).getByText('Étape 1 : aucun média')).toBeDefined();
    expect(within(row).getByText('Nuit · 2 étapes · jusqu’à 2 branches')).toBeDefined();
  });

  it('says there is none yet, and creates one under its own id', async () => {
    const calls = serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({ status: 200, body: [] }),
      [`POST ${BASE}`]: (body) => ({
        status: 201,
        body: viewOf({ content: CreatePreparedScriptBodySchema.parse(body).content }),
      }),
    });
    show();
    expect(await screen.findByText('Pas encore de script')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '＋ Nouveau script' }));
    fireEvent.change(await screen.findByLabelText('Nom'), { target: { value: 'Matin inventé' } });
    // Played the day and the night alike: chosen by hand, never read from its media (Charles, 20/11).
    fireEvent.click(screen.getByRole('radio', { name: 'jour et nuit' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Créer le brouillon' }).hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le brouillon' }));
    expect(await screen.findByRole('textbox', { name: 'Nom du script' })).toBeDefined();
    const created = calls.find((call) => call.method === 'POST');
    expect(created?.body).toMatchObject({
      platformAccountId: VAULT.folders[0]?.platformAccountId,
      content: { name: 'Matin inventé', moment: 'both', steps: [{ rhythm: 0 }] },
    });
  });

  it('saves a change a moment after it, on the revision read, and shows the server’s gaps', async () => {
    const calls = serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }),
      [`PUT ${BASE}/${SCRIPT}`]: (body) => ({
        status: 200,
        body: viewOf({
          revision: 2,
          content: SavePreparedScriptBodySchema.parse(body).content,
          gaps: [{ code: 'name_missing', step: null, branch: null, term: null }],
        }),
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    expect(screen.getByText('Rien ne manque')).toBeDefined();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nom du script' }), { target: { value: '' } });
    expect(screen.getByText('Modifications en cours')).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 50);
    });
    expect(await screen.findByText('Le script : il lui faut un nom')).toBeDefined();
    const saved = calls.filter((call) => call.method === 'PUT');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.body).toMatchObject({ basedOnRevision: 1, content: { name: '' } });
    expect(screen.getByRole('button', { name: /Prêt à copier/u }).hasAttribute('disabled')).toBe(true);
  });

  it('says when someone else saved it since, and reads it again', async () => {
    serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }),
      [`PUT ${BASE}/${SCRIPT}`]: () => ({
        status: 409,
        body: {
          error: {
            code: 'prepared_script_stale_conflict',
            message: 'Ce script a été enregistré par quelqu’un d’autre depuis ta lecture : recharge-le',
            details: {},
            requestId: 'r1',
          },
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description du script' }), {
      target: { value: 'Autre idée inventée' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 50);
    });
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeDefined();
  });

  it('offers only media imported and described, and adds the ones ticked', async () => {
    serve({ ...vaultRoutes, [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Choisir des médias' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Déjà dans cette branche')).toBeDefined();
    expect(within(dialog).getByText('Pas décrit : à décrire dans Médias')).toBeDefined();
    expect(within(dialog).queryByRole('checkbox', { name: 'Ce média' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Description inventée m4' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter 1' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByText('Modifications en cours')).toBeDefined();
  });

  it('sets a branch’s condition from the closed list', async () => {
    serve({ ...vaultRoutes, [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    fireEvent.click(screen.getByRole('button', { name: /Étape 2/u }));
    fireEvent.click(screen.getByRole('button', { name: /^Lu par l’IA\s*S’il aime le rouge$/u }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Dépense passée/u }));
    expect(within(dialog).getByRole('button', { name: 'OK' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('A déjà dépensé au moins (€)'), {
      target: { value: '50' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(await screen.findAllByText('A déjà dépensé 50 € ou plus chez elle')).not.toHaveLength(0);
  });

  it('asks before removing a branch, and keeps it on « Annuler »', async () => {
    serve({ ...vaultRoutes, [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    fireEvent.click(screen.getByRole('button', { name: /Étape 2/u }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer la branche' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getAllByRole('button', { name: 'Retirer la branche' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer la branche' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la branche, sûr' }));
    expect(screen.queryByRole('button', { name: 'Retirer la branche' })).toBeNull();
    expect(screen.getByText('Modifications en cours')).toBeDefined();
  });

  it('shows what a fan pays on each path', async () => {
    serve({ ...vaultRoutes, [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Soirée inventée/u }));
    const rail = screen.getByRole('complementary', { name: 'Ce qu’un fan paie' });
    expect(within(rail).getByText('Par défaut')).toBeDefined();
    expect(within(rail).getByText('S’il aime le rouge')).toBeDefined();
    expect(within(rail).getAllByText('15 €')).toHaveLength(2);
  });

  it('lists a script ready to copy, what differs still, and copies a text', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({
        status: 200,
        body: [viewOf({ state: 'ready_to_copy', copyDifferences: [{ code: 'name_not_found' }] })],
      }),
    });
    show();
    const tab = await screen.findByRole('tab', { name: /À copier dans Reveal/u });
    await waitFor(() => {
      expect(within(tab).getByText('1')).toBeDefined();
    });
    fireEvent.click(tab);
    expect(screen.getByText('Aucun script de ce nom dans Reveal pour l’instant')).toBeDefined();
    expect(screen.getByText('Scripts envoyés')).toBeDefined();
    const name = screen.getByText('Nom').closest<HTMLElement>('.se-copy__row');
    if (name === null) throw new Error('no name row');
    fireEvent.click(within(name).getByRole('button', { name: 'Copier' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(CONTENT.name);
    });
    expect(await screen.findByRole('button', { name: '✓ Copié' })).toBeDefined();
  });

  it('opens a script ready to copy back in « Scripts », in its editor', async () => {
    serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf({ state: 'ready_to_copy' })] }),
    });
    show();
    fireEvent.click(await screen.findByRole('tab', { name: /À copier dans Reveal/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le script' }));
    expect(await screen.findByRole('button', { name: /Ses scripts/u })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Scripts', selected: true })).toBeDefined();
  });
});

describe('Créatrices › Scripts, each view standing alone (for the creator sheet)', () => {
  it('« Scripts » lists her scripts, and opens at once the script it is given', async () => {
    serve({ ...vaultRoutes, [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf()] }) });
    const onCopy = vi.fn();
    show(<PreparedScriptsView creatorId={CREATOR} creatorName="Lina" onCopy={onCopy} />);
    expect(await screen.findByRole('button', { name: /Soirée inventée/u })).toBeDefined();
    expect(screen.getByRole('button', { name: /Nouveau script/u })).toBeDefined();
    expect(screen.queryByRole('tab')).toBeNull();
    cleanup();
    show(<PreparedScriptsView creatorId={CREATOR} creatorName="Lina" opening={viewOf()} onCopy={onCopy} />);
    expect(await screen.findByRole('button', { name: /Ses scripts/u })).toBeDefined();
  });

  it('« À copier dans Reveal » shows what is ready, then what she sent, and hands back a script to open', async () => {
    serve({
      ...vaultRoutes,
      [`GET ${BASE}`]: () => ({ status: 200, body: [viewOf({ state: 'ready_to_copy' })] }),
    });
    const onOpen = vi.fn();
    show(
      <ScriptsToCopyView
        creatorId={CREATOR}
        creatorName="Lina"
        sent={<p>Scripts envoyés</p>}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le script' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ state: 'ready_to_copy' }));
    expect(screen.getByText('Scripts envoyés')).toBeDefined();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
