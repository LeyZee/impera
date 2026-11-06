// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NameEditor } from './NameEditor';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/* An invented creator: no real person. */
const NORA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Nora x', timezone: 'Europe/Paris' };

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
  const onRenamed = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NameEditor creatorId={NORA.id} displayName={NORA.displayName} onRenamed={onRenamed} />
    </QueryClientProvider>,
  );
  return { sent, onRenamed };
}

function rename(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Renommer' }));
  fireEvent.change(screen.getByLabelText('Prénom ou pseudo'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le nom' }));
}

describe('NameEditor (ADR 0071 § 1)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    confirmIdentity.mockReset();
  });

  it('renames her to the name typed, trimmed, and says what did not change', async () => {
    const { sent, onRenamed } = serve({ status: 200, body: { ...NORA, displayName: 'Nora' } });
    expect(screen.getByText('Nom : Nora x')).toBeDefined();
    rename('  Nora ');
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Renommée : Nora. Son pseudo Reveal et sa persona n’ont pas changé.',
    );
    expect(sent).toEqual([{ displayName: 'Nora' }]);
    expect(onRenamed).toHaveBeenCalledWith({ ...NORA, displayName: 'Nora' });
  });

  it('sends nothing for the same name or a name without a letter', () => {
    const { sent } = serve();
    fireEvent.click(screen.getByRole('button', { name: 'Renommer' }));
    const save = screen.getByRole('button', { name: 'Enregistrer le nom' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Prénom ou pseudo'), { target: { value: '!!' } });
    expect(screen.getByText('Le nom doit contenir au moins une lettre.')).toBeDefined();
    expect(save).toHaveProperty('disabled', true);
    expect(sent).toEqual([]);
  });

  it('says another creator has this name, and keeps hers', async () => {
    const { onRenamed } = serve({ status: 409, body: apiError('creator_name_conflict') });
    rename('Lou');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Une créatrice porte déjà ce nom. Ajoute une initiale ou choisis un autre pseudo.',
    );
    expect(screen.getByLabelText('Prénom ou pseudo').getAttribute('aria-invalid')).toBe('true');
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('asks for the password again after 10 minutes, then renames her', async () => {
    const { sent, onRenamed } = serve(
      { status: 403, body: apiError(REAUTHENTICATION_ERROR_CODE) },
      { status: 200, body: { ...NORA, displayName: 'Nora' } },
    );
    confirmIdentity.mockResolvedValue('ok');
    rename('Nora');
    expect(await screen.findByText('Pour la renommer, confirme ton mot de passe et ton code.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enregistrer le nom' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'staple battery horse' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => {
      expect(onRenamed).toHaveBeenCalled();
    });
    expect(sent).toHaveLength(2);
  });
});
