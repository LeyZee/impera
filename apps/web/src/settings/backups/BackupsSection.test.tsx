// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BackupsSection } from './BackupsSection';

const confirmPassword = vi.fn<(password: string) => Promise<string>>();
vi.mock('@/settings/services/api', () => ({
  confirmPassword: (password: string) => confirmPassword(password),
}));

const SHA = '3f1c'.repeat(16);
const REPORT = [
  `export sha256: ${SHA}`,
  'restored in 252 s, worker queue emptied',
  'row counts: all 31 tables match',
].join('\n');

const STATUS = {
  state: 'ok',
  lastSucceededAt: '2026-10-27T02:12:00Z',
  overdueAfterHours: 26,
  lastRun: {
    status: 'succeeded',
    startedAt: '2026-10-27T02:00:00Z',
    finishedAt: '2026-10-27T02:03:30Z',
    sizeBytes: 42_400_000,
    error: null,
  },
  lastRestoreTest: null,
  restoreTestFresh: false,
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1/backups`: the status as `status` says, each POST answered by `post` and kept in `posted`. */
function serve(routes: { status?: () => Reply; post?: (body: unknown) => Reply }): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const reply =
        init?.method === 'POST'
          ? (() => {
              const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
              posted.push(body);
              return routes.post?.(body) ?? { status: 500 };
            })()
          : url === '/v1/backups/status'
            ? (routes.status?.() ?? { status: 200, body: STATUS })
            : { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return posted;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BackupsSection />
    </QueryClientProvider>,
  );
}

/** The recorded test, as the server answers it: the body sent, plus when it was written. */
const recorded = (body: unknown): Reply => ({
  status: 201,
  body: { ...z.record(z.string(), z.unknown()).parse(body), createdAt: '2026-10-27T10:00:00.000Z' },
});

beforeEach(() => {
  confirmPassword.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Sauvegardes', () => {
  it('shows the nightly copy, then the restore test with its one action', async () => {
    serve({});
    renderPage();
    expect(await screen.findByRole('heading', { name: /^Sauvegardée le 27 octobre/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Aucun essai de restauration noté' })).toBeTruthy();
    expect(screen.getByText(/42,4 Mo chiffrés/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Noter un essai' }).className).toContain('nv-btn--neon');
  });

  it('offers no test to record before a copy has ever succeeded', async () => {
    serve({
      status: () => ({
        status: 200,
        body: { ...STATUS, state: 'never', lastSucceededAt: null, lastRun: null },
      }),
    });
    renderPage();
    const button = await screen.findByRole('button', { name: 'Noter un essai' });
    expect(button).toHaveProperty('disabled', true);
    expect(screen.getByText('Il faut d’abord une sauvegarde réussie à restaurer.')).toBeTruthy();
  });

  it('says the server does not answer, after one quiet retry, and tries again', async () => {
    let answers = 0;
    serve({ status: () => (answers++ < 2 ? { status: 500 } : { status: 200, body: STATUS }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }, { timeout: 3000 }));
    expect(await screen.findByRole('button', { name: 'Noter un essai' })).toBeTruthy();
    expect(answers).toBe(3);
  });

  it('reads the pasted report into the fields, asks the password again, then records the test once', async () => {
    let attempts = 0;
    const posted = serve({
      post: (body) =>
        attempts++ === 0 ? { status: 403, body: apiError('reauthentication_forbidden') } : recorded(body),
    });
    confirmPassword.mockResolvedValue('ok');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noter un essai' }));
    const dialog = screen.getByRole('dialog', { name: 'Noter un essai de restauration' });

    fireEvent.change(within(dialog).getByLabelText('Compte rendu de l’essai'), { target: { value: REPORT } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    expect(within(dialog).getByLabelText<HTMLInputElement>('Empreinte de la sauvegarde').value).toBe(SHA);
    expect(within(dialog).getByLabelText<HTMLInputElement>('Durée de la restauration').value).toBe('252');
    expect(within(dialog).getByText('En secondes : 4 min 12 s.')).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Tables qui diffèrent').value).toBe('0');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’essai' }));
    fireEvent.change(await within(dialog).findByLabelText('Mot de passe'), { target: { value: 'secret' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByRole('heading', { name: 'Essai noté' })).toBeTruthy();
    expect(screen.getByText(/restauré en 4 min 12 s, toutes les lignes retrouvées/u)).toBeTruthy();
    expect(confirmPassword).toHaveBeenCalledWith('secret');
    expect(posted).toHaveLength(2);
    const [first, second] = posted;
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      backupSha256: SHA,
      durationSeconds: 252,
      rowCountMismatches: 0,
      notes: null,
    });
  });

  it('says on the field an unknown fingerprint, and lets it be fixed', async () => {
    const posted = serve({
      post: () => ({ status: 422, body: apiError('restore_test_backup_unprocessable') }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noter un essai' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Compte rendu de l’essai'), { target: { value: REPORT } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’essai' }));

    expect(await within(dialog).findByText(/Aucune sauvegarde réussie n’a cette empreinte/u)).toBeTruthy();
    expect(within(dialog).getByLabelText('Empreinte de la sauvegarde').getAttribute('aria-invalid')).toBe(
      'true',
    );
    fireEvent.change(within(dialog).getByLabelText('Empreinte de la sauvegarde'), {
      target: { value: 'b'.repeat(64) },
    });
    expect(within(dialog).queryByText(/Aucune sauvegarde réussie n’a cette empreinte/u)).toBeNull();
    expect(posted).toHaveLength(1);
  });

  it('says an ended session as such, with the way back in', async () => {
    serve({ post: () => ({ status: 401, body: apiError('session_unauthenticated') }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noter un essai' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Compte rendu de l’essai'), { target: { value: REPORT } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’essai' }));

    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/ta session a expiré/u);
    expect(within(dialog).getByRole('button', { name: 'Se reconnecter' })).toBeTruthy();
  });

  it('sends nothing while a field is wrong, and says so on each', async () => {
    const posted = serve({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noter un essai' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Saisir à la main' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’essai' }));
    expect(await within(dialog).findByText(/L’empreinte compte 64 caractères/u)).toBeTruthy();
    expect(within(dialog).getByText(/Un nombre entier de secondes/u)).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it('tells a paste that is not a report, and closes on Escape', async () => {
    serve({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Noter un essai' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Compte rendu de l’essai'), {
      target: { value: 'bonjour' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/ni empreinte, ni durée/u);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens the steps of a test while none is fresh, and never says Remote Control (REG-23)', async () => {
    serve({});
    renderPage();
    await screen.findByRole('button', { name: 'Noter un essai' });
    const steps = screen.getByText('Comment se joue un essai').closest('details');
    expect(steps?.open).toBe(true);
    expect(screen.getByText(/Une session Claude sur ton PC le joue/u)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Remote Control/u);
  });

  it('keeps the steps folded once the test is fresh', async () => {
    serve({
      status: () => ({
        status: 200,
        body: {
          ...STATUS,
          lastRestoreTest: {
            testedAt: '2026-10-20T15:00:00Z',
            backupFinishedAt: '2026-10-20T01:05:00Z',
            durationSeconds: 252,
            rowCountMismatches: 0,
          },
          restoreTestFresh: true,
        },
      }),
    });
    renderPage();
    await screen.findByRole('button', { name: 'Noter un essai' });
    expect(screen.getByText('Comment se joue un essai').closest('details')?.open).toBe(false);
  });

  it('asks for an export now, the password again, then says the request waits (REG-24)', async () => {
    let attempts = 0;
    let asked: string | null = null;
    const posted = serve({
      status: () => ({ status: 200, body: asked === null ? STATUS : { ...STATUS, runRequestedAt: asked } }),
      post: (body) => {
        if (attempts++ === 0) return { status: 403, body: apiError('reauthentication_forbidden') };
        asked = '2026-10-27T09:58:00.000Z';
        const { id } = z.object({ id: z.string() }).parse(body);
        return { status: 202, body: { id, requestedAt: asked, pickedAt: null } };
      },
    });
    confirmPassword.mockResolvedValue('ok');
    renderPage();
    const button = await screen.findByRole('button', { name: 'Relancer la sauvegarde maintenant' });
    expect(button.className).toContain('nv-btn--soft');
    fireEvent.click(button);
    fireEvent.change(await screen.findByLabelText('Mot de passe'), { target: { value: 'secret' } });
    // « Noter un essai » stays the page's one neon while the password is asked here.
    expect(screen.getByRole('button', { name: 'Confirmer' }).className).toContain('nv-btn--soft');
    expect(document.querySelectorAll('.nv-btn--neon')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    const line = await screen.findByRole('status');
    expect(line.textContent).toMatch(/^Relance demandée à /u);
    // The button is gone: the keyboard lands on the line that replaced it, not at the top of the page.
    await waitFor(() => {
      expect(document.activeElement).toBe(line);
    });
    expect(screen.queryByRole('button', { name: 'Relancer la sauvegarde maintenant' })).toBeNull();
    expect(posted).toHaveLength(2);
    const [first, second] = posted;
    expect(second).toEqual(first);
  });

  it('says an export already running, and offers nothing while it runs', async () => {
    serve({ post: () => ({ status: 409, body: apiError('backup_run_in_progress_conflict') }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Relancer la sauvegarde maintenant' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/déjà en cours/u);
  });

  it('keeps the keyboard on the strip when the export it found running hides the button', async () => {
    let running = false;
    serve({
      status: () => ({
        status: 200,
        body: running
          ? { ...STATUS, lastRun: { ...STATUS.lastRun, status: 'running', finishedAt: null } }
          : STATUS,
      }),
      post: () => {
        running = true;
        return { status: 409, body: apiError('backup_run_in_progress_conflict') };
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Relancer la sauvegarde maintenant' }));
    expect(await screen.findByText(/^Une sauvegarde est en cours depuis /u)).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('bk-copy-title');
    });
    expect(screen.queryByRole('button', { name: 'Relancer la sauvegarde maintenant' })).toBeNull();
  });

  it('reads the status again while the request waits, until the export has run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let reads = 0;
      serve({
        status: () => {
          reads += 1;
          return {
            status: 200,
            body: reads === 1 ? { ...STATUS, runRequestedAt: '2026-10-27T09:58:00.000Z' } : STATUS,
          };
        },
      });
      renderPage();
      expect((await screen.findByRole('status')).textContent).toMatch(/^Relance demandée à /u);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await screen.findByRole('button', { name: 'Relancer la sauvegarde maintenant' })).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
