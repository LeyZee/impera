// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { LinksSection } from './LinksSection';

import { choose } from '@/test/select';

/* An invented creator and invented links: no real person, no real address. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const STORY = {
  id: '0192f3a0-0000-7000-8000-0000000000e1',
  name: 'Story du jour',
  url: 'https://liens.example.test/nora/story',
  destination: '',
  placement: 'story_daily',
  usageNote: 'À coller dans ta story du jour',
  enabled: true,
};
const OLD = {
  id: '0192f3a0-0000-7000-8000-0000000000e2',
  name: 'Ancien lien',
  url: 'https://liens.example.test/nora/ancien',
  destination: 'mon Reveal',
  placement: null,
  usageNote: '',
  enabled: true,
};

interface Write {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function serve(links: unknown[], answer: (write: Write) => Response = () => new Response('{}')): Write[] {
  const writes: Write[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (init?.method === undefined || init.method === 'GET')
        return Promise.resolve(new Response(JSON.stringify({ links })));
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
      const write = { method: init.method, path, body };
      writes.push(write);
      return Promise.resolve(answer(write));
    }),
  );
  return writes;
}

function renderSection(canEdit = true): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LinksSection creatorId={CREATOR} creatorName="Nora" canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Liens (INS-03, ADR 0121 § 1)', () => {
  it('lists her links, says « à renseigner » for one without a place, and offers no way to remove one', async () => {
    serve([STORY, OLD]);
    renderSection();
    const list = await screen.findByRole('list', { name: 'Liens de redirection' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] ?? list).getByText('Story du jour', { selector: '.nv-tag' })).toBeDefined();
    expect(within(rows[1] ?? list).getByText('Endroit à renseigner')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Retirer|Supprimer/u })).toBeNull();
  });

  it('switches a link off with the rest of it unchanged', async () => {
    const writes = serve([STORY], () => new Response(JSON.stringify({ ...STORY, enabled: false })));
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: 'Lien « Story du jour » : allumé' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    const { id, ...rest } = STORY;
    expect(writes[0]).toEqual({
      method: 'PUT',
      path: `/v1/creators/${CREATOR}/redirect-links/${id}`,
      body: { ...rest, enabled: false },
    });
  });

  it('adds a link from the dialog, trimmed, once its lines pass', async () => {
    const writes = serve(
      [],
      (write) =>
        new Response(
          JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(write.body), id: STORY.id }),
        ),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter un lien/u }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nom'), { target: { value: ' Story du jour ' } });
    fireEvent.change(within(dialog).getByLabelText('Adresse'), {
      target: { value: 'http://liens.example.test/nora' },
    });
    fireEvent.change(within(dialog).getByLabelText('Phrase d’usage'), {
      target: { value: 'Va sur liens.example.test/nora' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(
      within(dialog).getByText('Une adresse complète qui commence par https://, sans espace.'),
    ).toBeDefined();
    expect(
      within(dialog).getByText('Dis-le en mots, sans adresse : elle copie le lien avec le bouton.'),
    ).toBeDefined();
    expect(writes).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Adresse'), {
      target: { value: ' https://liens.example.test/nora ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Phrase d’usage'), {
      target: { value: 'À coller dans ta story du jour' },
    });
    choose(within(dialog).getByRole('combobox', { name: 'Où il est posé' }), /Story du jour/u);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toEqual({
      method: 'POST',
      path: `/v1/creators/${CREATOR}/redirect-links`,
      body: {
        name: 'Story du jour',
        url: 'https://liens.example.test/nora',
        destination: '',
        placement: 'story_daily',
        usageNote: 'À coller dans ta story du jour',
        enabled: true,
      },
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows the server’s refusal in the dialog and keeps it open', async () => {
    serve(
      [STORY],
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'redirect_link_name_conflict', message: 'x', details: {}, requestId: 'r1' },
          }),
          { status: 409 },
        ),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier le lien « Story du jour »' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Un autre lien porte déjà ce nom.')).toBeDefined();
  });

  it('lets a manager read her links, with no switch, no « Modifier » and no « Ajouter »', async () => {
    serve([STORY, OLD]);
    renderSection(false);
    const list = await screen.findByRole('list', { name: 'Liens de redirection' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Modifier/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ajouter un lien/u })).toBeNull();
    expect(screen.getByText('Seul le propriétaire ajoute ou modifie un lien.')).toBeDefined();
  });

  it('asks the password and the code when the sign-in is old, before a switch is written', async () => {
    const writes = serve(
      [STORY],
      () =>
        new Response(
          JSON.stringify({
            error: { code: REAUTHENTICATION_ERROR_CODE, message: 'x', details: {}, requestId: 'r1' },
          }),
          {
            status: 403,
          },
        ),
    );
    renderSection();
    const toggle = await screen.findByRole<HTMLInputElement>('switch');
    const before = toggle.getAttribute('aria-label');
    const wasOn = toggle.checked;
    fireEvent.click(toggle);
    // The prompt names the gesture and sits in the link's own row; the switch keeps its state, « Annuler » too.
    const lead = await screen.findByText(
      /^Pour (allumer|éteindre) « .+ », confirme ton mot de passe et ton code\.$/u,
    );
    expect(lead.closest('li')).toBe(toggle.closest('li'));
    expect(writes).toHaveLength(1);
    expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(wasOn);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText(/confirme ton mot de passe/u)).toBeNull();
    expect(screen.getByRole('switch').getAttribute('aria-label')).toBe(before);
    expect(writes).toHaveLength(1);
  });
});
