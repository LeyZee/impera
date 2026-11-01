// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { NewCreatorForm } from './NewCreatorForm';

/* An invented creator: no real data. */
const LEA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Léa', timezone: 'Europe/Paris' };

function show(status: number, body?: unknown) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body ?? {}), { status })),
  );
  vi.stubGlobal('fetch', fetch);
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewCreatorForm onCreated={onCreated} onCancel={null} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Prénom ou pseudo'), { target: { value: ' Léa ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
  return { fetch, onCreated };
}

/** The JSON body of the n-th request the form sent. */
function sentBody(fetch: ReturnType<typeof show>['fetch'], call = 0): unknown {
  const body = fetch.mock.calls[call]?.[1].body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('NewCreatorForm', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates her with the name typed and Paris by default', async () => {
    const { fetch, onCreated } = show(201, LEA);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(LEA);
    });
    expect(fetch).toHaveBeenCalledWith('/v1/creators', expect.objectContaining({ method: 'POST' }));
    const sent = z.object({ id: z.string(), displayName: z.string(), timezone: z.string() }).strict();
    const body = sent.parse(sentBody(fetch));
    expect(body.id).toMatch(ID);
    expect(body).toMatchObject({ displayName: 'Léa', timezone: 'Europe/Paris' });
  });

  it('offers her zone by city, the zone kept behind it (CREA-27)', () => {
    show(201, LEA);
    const zone = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Fuseau horaire' });
    expect(zone.selectedOptions[0]?.textContent).toBe('Paris');
    const montreal = screen.getByRole<HTMLOptionElement>('option', { name: 'Toronto (Montréal)' });
    expect(montreal.value).toBe('America/Toronto');
    expect(screen.getByRole('option', { name: 'Tokyo · Asia' })).toBeDefined();
  });

  it('sends once when the form is submitted again before the answer', async () => {
    const { fetch, onCreated } = show(201, LEA);
    // Submitting the form itself skips the disabled button: only the guard stops a second request.
    const form = screen.getByRole('button', { name: /Créer|Création/ }).closest('form');
    if (form === null) throw new Error('no form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends the same id again after a failure, so a retry cannot make a twin', async () => {
    const { fetch } = show(503);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    const first = z.object({ id: z.string() }).parse(sentBody(fetch, 0)).id;
    expect(first).toMatch(ID);
    expect(z.object({ id: z.string() }).parse(sentBody(fetch, 1)).id).toBe(first);
  });

  const refused = (fields: { path: string; message: string }[]) => ({
    error: { code: 'request_invalid', message: 'Requête invalide', details: { fields }, requestId: 'req-1' },
  });

  it('says what went wrong and creates nothing', async () => {
    const { onCreated } = show(400, refused([{ path: '/timezone', message: 'Fuseau horaire IANA inconnu' }]));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Ce fuseau n’existe pas. Choisis une ville dans la liste.',
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says when the same form already made her under another name', async () => {
    const { onCreated } = show(409);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Cette créatrice vient d’être créée sous un autre nom. Recharge la page pour la voir.',
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says when another creator has this name, and forgets it once the name is typed again', async () => {
    const { fetch, onCreated } = show(409, {
      error: { code: 'creator_name_conflict', message: 'x', details: {}, requestId: 'r' },
    });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Une créatrice porte déjà ce nom. Ajoute une initiale ou choisis un autre pseudo.',
    );
    expect(onCreated).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Prénom ou pseudo');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    fireEvent.change(field, { target: { value: 'Léa B.' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // Nothing was created: the same form's id goes again with the new name.
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...LEA, displayName: 'Léa B.' }), { status: 201 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    const id = (call: number) => z.object({ id: z.string() }).parse(sentBody(fetch, call)).id;
    expect(id(1)).toBe(id(0));
  });

  it('will not send a name without a letter', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewCreatorForm onCreated={vi.fn()} onCancel={null} />
      </QueryClientProvider>,
    );
    for (const value of ['...', '\u200B', '2024']) {
      fireEvent.change(screen.getByLabelText('Prénom ou pseudo'), { target: { value } });
      expect(screen.getByRole('button', { name: 'Créer' })).toHaveProperty('disabled', true);
      const message = screen.getByText('Le nom doit contenir au moins une lettre.');
      const field = screen.getByLabelText('Prénom ou pseudo');
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe(message.id);
    }
  });

  it('blames the zone only when the server refused the zone, and a lost session is not a silent server', async () => {
    show(400, refused([{ path: '/displayName', message: 'Too big' }]));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Ce nom n’est pas accepté : il lui faut au moins une lettre.',
    );
    const field = screen.getByLabelText('Prénom ou pseudo');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    cleanup();
    show(401, { error: { code: 'session_unauthenticated', message: 'x', details: {}, requestId: 'r' } });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Ta session a expiré : reconnecte-toi, puis recommence. Rien n’a été créé.',
    );
    expect(screen.getByRole('button', { name: 'Se reconnecter' })).toBeDefined();
  });

  it('cannot create a creator without a name', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewCreatorForm onCreated={vi.fn()} onCancel={null} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Créer' })).toHaveProperty('disabled', true);
  });
});
