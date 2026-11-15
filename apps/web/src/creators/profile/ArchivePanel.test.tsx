// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchivePanel, plannedText } from './ArchivePanel';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/* An invented creator: no real person. */
const NORA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Nora', timezone: 'Europe/Paris' };

const apiError = (code: string, details: Record<string, unknown> = {}): unknown => ({
  error: { code, message: code, details, requestId: 'r1' },
});

/** A fake `POST /v1/creators/:creatorId/archive`: each call answered by the next reply. */
function serve(...replies: { status: number; body?: unknown }[]) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    expect(url).toBe(`/v1/creators/${NORA.id}/archive`);
    expect(init?.method).toBe('POST');
    const reply = replies.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ArchivePanel creatorId={NORA.id} creatorName={NORA.displayName} />
    </QueryClientProvider>,
  );
  return { fetch, invalidate };
}

function archive(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Archiver…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archiver Nora' }));
}

describe('ArchivePanel (ADR 0071 § 2)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    confirmIdentity.mockReset();
  });

  it('says what changes before anything is sent, and sends nothing on « Annuler »', () => {
    const { fetch } = serve();
    fireEvent.click(screen.getByRole('button', { name: 'Archiver…' }));
    expect(screen.getByText('Archiver Nora ?')).toBeDefined();
    expect(screen.getByText(/Son agent s’arrête/)).toBeDefined();
    expect(
      screen.getByText(/Ses vignettes sont effacées dans 90 jours, le .+\. Rouverte avant, rien ne part\./),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('button', { name: 'Archiver…' })).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('archives her and refreshes the creators', async () => {
    const { invalidate } = serve({
      status: 200,
      body: { ...NORA, archivedAt: '2026-11-05T20:00:00.000Z' },
    });
    archive();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['creators'] });
    });
  });

  it('says how many shifts still plan her, and archives nothing', async () => {
    const { invalidate } = serve({
      status: 409,
      body: apiError('creator_planned_conflict', { shiftsAhead: 2, templatesRunning: 1 }),
    });
    archive();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Elle est encore au planning : 2 shifts à venir et 1 shift régulier. Retire-les dans l’agenda, puis archive-la.',
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('asks for the password again after 10 minutes, then archives her', async () => {
    const { fetch } = serve(
      { status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) },
      { status: 200, body: { ...NORA, archivedAt: '2026-11-05T20:00:00.000Z' } },
    );
    confirmIdentity.mockResolvedValue('ok');
    archive();
    expect(await screen.findByText('Pour l’archiver, confirme ton mot de passe et ton code.')).toBeDefined();
    // Only the prompt's own buttons while it asks: never two « Annuler » one under the other.
    expect(screen.getAllByRole('button', { name: 'Annuler' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Archiver / })).toBeNull();
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'staple battery horse' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('names what still plans her in French', () => {
    expect(plannedText(1, 0)).toBe('1 shift à venir');
    expect(plannedText(0, 3)).toBe('3 shifts réguliers');
  });
});
