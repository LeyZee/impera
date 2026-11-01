// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ZoneEditor } from './ZoneEditor';

const confirmPassword = vi.fn<(password: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmPassword: (password: string) => confirmPassword(password),
}));

/* An invented creator: no real person. */
const NORA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Nora', timezone: 'Europe/Paris' };

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `PATCH /v1/creators/:creatorId`: each call answered by the next reply, its body kept. */
function serve(...replies: { status: number; body?: unknown }[]) {
  const sent: unknown[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    expect(url).toBe(`/v1/creators/${NORA.id}`);
    expect(init?.method).toBe('PATCH');
    sent.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
    const reply = replies.shift() ?? { status: 500 };
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const onMoved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ZoneEditor creatorId={NORA.id} timeZone={NORA.timezone} onMoved={onMoved} />
    </QueryClientProvider>,
  );
  return { sent, onMoved };
}

/** Opens the field, picks `zone` (a city, its zone behind it) and saves. */
function move(zone: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Changer de fuseau' }));
  fireEvent.change(screen.getByLabelText('Fuseau'), { target: { value: zone } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le fuseau' }));
}

describe('ZoneEditor', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    confirmPassword.mockReset();
  });

  it('moves her to the zone typed and says so', async () => {
    const { sent, onMoved } = serve({ status: 200, body: { ...NORA, timezone: 'America/New_York' } });
    // Her zone reads by its city, as on every screen (CREA-27).
    expect(screen.getByText('Fuseau : Paris')).toBeDefined();
    move('America/New_York');
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Fuseau changé : New York. Ses heures suivent ce fuseau dès maintenant.',
    );
    expect(sent).toEqual([{ timezone: 'America/New_York' }]);
    expect(onMoved).toHaveBeenCalledWith({ ...NORA, timezone: 'America/New_York' });
  });

  it('puts the focus in the field when it opens, and back on its button when it closes', async () => {
    serve({ status: 200, body: { ...NORA, timezone: 'Asia/Tokyo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer de fuseau' }));
    // The focus moves in an effect after the render: waited for, not read at once.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Fuseau'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Changer de fuseau' }));
    });
    move('Asia/Tokyo');
    await screen.findByRole('status');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Changer de fuseau' }));
    });
  });

  it('cannot save her own zone again, nor an empty one', () => {
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Changer de fuseau' }));
    const saveZone = screen.getByRole('button', { name: 'Enregistrer le fuseau' });
    expect(saveZone).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Fuseau'), { target: { value: '  ' } });
    expect(saveZone).toHaveProperty('disabled', true);
  });

  it('asks for the password when the sign-in is too old, then saves again', async () => {
    const { sent, onMoved } = serve(
      { status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) },
      { status: 200, body: { ...NORA, timezone: 'Asia/Tokyo' } },
    );
    confirmPassword.mockResolvedValue('ok');
    move('Asia/Tokyo');
    expect(await screen.findByText('Pour changer son fuseau, confirme ton mot de passe.')).toBeDefined();
    expect(onMoved).not.toHaveBeenCalled();
    // Saving again waits for the password, never a second request behind it.
    expect(screen.getByRole('button', { name: 'Enregistrer le fuseau' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'staple battery horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => {
      expect(onMoved).toHaveBeenCalled();
    });
    expect(z.array(z.object({ timezone: z.string() })).parse(sent)).toHaveLength(2);
  });

  it('says what went wrong and keeps her zone', async () => {
    const { onMoved } = serve(
      { status: 400, body: apiError('request_invalid') },
      { status: 403, body: apiError('role_forbidden') },
    );
    // A city of the list the server does not know (an older zone base): said, and her zone kept.
    move('Asia/Tokyo');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Ce fuseau n’existe pas. Choisis une ville dans la liste.',
    );
    expect(screen.getByLabelText('Fuseau').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('Fuseau'), { target: { value: 'Europe/Rome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le fuseau' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Seul le compte propriétaire change le fuseau d’une créatrice.',
    );
    expect(onMoved).not.toHaveBeenCalled();
  });
});
