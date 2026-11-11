// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchivedCreators, thumbnailsLine } from './ArchivedCreators';

/* Invented creators: no real person. */
const NORA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Nora', timezone: 'Europe/Paris' };

function serve(archived: unknown[], restore: { status: number; body?: unknown } = { status: 500 }) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/v1/creators/archived') {
      return Promise.resolve(new Response(JSON.stringify({ creators: archived }), { status: 200 }));
    }
    expect(url).toBe(`/v1/creators/${NORA.id}/restore`);
    expect(init?.method).toBe('POST');
    return Promise.resolve(
      new Response(restore.body === undefined ? null : JSON.stringify(restore.body), {
        status: restore.status,
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const onRestored = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ArchivedCreators onRestored={onRestored} />
    </QueryClientProvider>,
  );
  return { onRestored, view };
}

describe('ArchivedCreators (ADR 0071 § 2)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows nothing while none is archived', async () => {
    const { view } = serve([]);
    await waitFor(() => {
      expect(view.container.textContent).toBe('');
    });
  });

  it('lists her folded with the day she was archived, and reopens her', async () => {
    const { onRestored } = serve([{ ...NORA, archivedAt: '2026-11-05T20:00:00.000Z' }], {
      status: 200,
      body: NORA,
    });
    expect(await screen.findByText('Archivées')).toBeDefined();
    expect(screen.getByText('1 créatrice')).toBeDefined();
    expect(screen.getByText('· archivée le 5 novembre 2026', { exact: false })).toBeDefined();
    expect(screen.getByText(/vignettes (gardées|effacées)/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Rouvrir' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Rouverte : Nora. Son agent reste à l’arrêt : relance-le depuis le Dashboard. Son espace se rouvre avec un nouveau lien, dans l’onglet Accès.',
    );
    expect(onRestored).toHaveBeenCalledWith(NORA.id);
  });

  it('says until when her reduced pictures stay, then that they went (ADR 0089)', () => {
    const archivedAt = '2026-11-05T20:00:00.000Z';
    expect(thumbnailsLine(archivedAt, new Date('2026-11-11T12:00:00.000Z'))).toBe(
      'vignettes gardées jusqu’au 3 février 2027',
    );
    expect(thumbnailsLine(archivedAt, new Date('2027-02-03T20:00:00.000Z'))).toBe('vignettes effacées');
  });
});
