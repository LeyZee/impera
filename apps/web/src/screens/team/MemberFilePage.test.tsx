// @vitest-environment jsdom
import { BillingRegimeSchema, TeamMemberSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemberFilePage } from './MemberFilePage';

import {
  BENIN_DRAFT,
  BENIN_REGIME,
  contractorRegimeOf,
  documentOf,
  fileOf,
  fileServer,
  FRANCE_REGIME,
  profileOf,
  serveFile,
  type FileServer,
} from '@/test/contractors';
import { IRIS, OWNER, OWNER_USER, payId, THEO } from '@/test/pay';
import { chooseValue, openList } from '@/test/select';

let server: FileServer;

function renderPage(memberId: string = THEO.id): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/equipe/membres/$memberId/dossier',
    component: () => <MemberFilePage user={OWNER} memberId={memberId} />,
  });
  const members = createRoute({ getParentRoute: () => root, path: '/equipe/membres', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, members]),
    history: createMemoryHistory({ initialEntries: [`/equipe/membres/${memberId}/dossier`] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const panelOf = (title: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name: title });
  const panel = heading.closest('section');
  if (panel === null) throw new Error(`No panel ${title}`);
  return panel;
};

const dialog = (): HTMLElement => screen.getByRole('dialog');

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  server = fileServer();
  serveFile(server);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Équipe › Membres › Dossier', () => {
  it('checks the file as the owner read it, and says when it changed since', async () => {
    server.file = fileOf({ profile: profileOf({ verifiedAt: null, invoicePrefix: null }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Dossier de Théo' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Membres' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Sa fiche' }).getAttribute('href')).toBe(
      `/equipe/membres?membre=${THEO.id}`,
    );
    const identity = await waitFor(() => panelOf('Son dossier'));
    expect(within(identity).getByText('À vérifier').className).toBe('rp-chip rp-chip--warn');
    expect(within(identity).queryByRole('button', { name: 'Modifier' })).toBeNull();

    fireEvent.click(within(identity).getByRole('button', { name: 'Vérifier' }));
    server.refusal = { status: 409, code: 'contractor_profile_changed_conflict' };
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Vérifié' }));
    expect((await within(dialog()).findByRole('alert')).textContent).toBe(
      'Le dossier a changé depuis sa lecture : vérifie ce qui s’affiche maintenant.',
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Vérifié' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes.map((one) => [one.method, one.path, one.body])).toEqual([
      [
        'POST',
        `/v1/payroll/contractors/${THEO.id}/profile/verify`,
        { updatedAt: '2026-10-31T08:30:00.000Z' },
      ],
      [
        'POST',
        `/v1/payroll/contractors/${THEO.id}/profile/verify`,
        { updatedAt: '2026-10-31T08:30:00.000Z' },
      ],
    ]);
  });

  it('sets the prefix in capitals until the first invoice freezes it', async () => {
    server.file = fileOf({ profile: profileOf({ invoicePrefix: null }) });
    renderPage();
    const field = await screen.findByLabelText('Préfixe des factures');
    fireEvent.change(field, { target: { value: 't' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('De 2 à 8 majuscules ou chiffres, par exemple NORA.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'theo' } });
    server.refusal = { status: 409, code: 'invoice_prefix_taken_conflict' };
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Un autre prestataire a déjà ce préfixe.');
    fireEvent.change(field, { target: { value: 'theob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Préfixe enregistré.');
    expect(server.writes.map((one) => one.body)).toEqual([
      { invoicePrefix: 'THEO' },
      { invoicePrefix: 'THEOB' },
    ]);
    expect(server.writes[0]?.method).toBe('PUT');

    cleanup();
    server.file = fileOf({ prefixFrozen: true });
    renderPage();
    const identity = await waitFor(() => panelOf('Son dossier'));
    await waitFor(() => {
      expect(identity.textContent).toContain('figé par la première facture');
    });
    expect(screen.queryByLabelText('Préfixe des factures')).toBeNull();
  });

  it('gives a regime of the member’s country from a day on, never backwards', async () => {
    renderPage();
    const regime = await waitFor(() => panelOf('Régime de facturation'));
    await waitFor(() => {
      expect(regime.textContent).toContain('Prestataire Bénin et Madagascar, depuis le 1er novembre 2026');
    });
    expect(regime.textContent).toContain('validé par le comptable le 30 octobre 2026');
    expect(regime.textContent).toContain('attestation de résidence fiscale');

    fireEvent.click(within(regime).getByRole('button', { name: 'Attribuer un régime' }));
    // Two regimes: chips in sight, never a list to open (five at most, docs/design/README.md).
    expect(within(dialog()).queryByRole('combobox', { name: 'Régime' })).toBeNull();
    const choices = within(dialog()).getByRole('radiogroup', { name: 'Régime' });
    // The regimes of Benin alone, the newest first: never the one of France.
    expect(
      within(choices)
        .getAllByRole('radio')
        .map((one) => [one.textContent, one.getAttribute('aria-checked')]),
    ).toEqual([
      [BENIN_DRAFT.name, 'true'],
      [BENIN_REGIME.name, 'false'],
    ]);
    expect(within(dialog()).getByText(/^Pas encore validé par le comptable/u).className).toBe(
      'tm-hint cf-amber',
    );
    fireEvent.click(within(choices).getByRole('radio', { name: BENIN_REGIME.name }));
    expect(within(choices).getByRole('radio', { name: BENIN_REGIME.name }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.change(within(dialog()).getByLabelText('À partir du'), { target: { value: '2026-11-04' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    expect(within(dialog()).getByText('Aujourd’hui au plus tôt, le 5 novembre 2026.')).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText('À partir du'), { target: { value: '2026-11-16' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes.map((one) => [one.method, one.path])).toEqual([
      ['POST', `/v1/payroll/contractors/${THEO.id}/regimes`],
    ]);
    expect(server.writes[0]?.body).toMatchObject({ regimeId: BENIN_REGIME.id, from: '2026-11-16' });
  });

  it('offers the regimes in the design system’s list past five, never more chips', async () => {
    // Six regimes for Benin: one validated, five versions after it.
    const versions = [2, 3, 4, 5, 6].map((n) =>
      BillingRegimeSchema.parse({
        ...BENIN_REGIME,
        id: payId(700 + n),
        name: `Prestataire Bénin, version ${String(n)}`,
        createdAt: `2026-11-0${String(n)}T08:00:00.000Z`,
      }),
    );
    server.regimes = [...versions.toReversed(), BENIN_REGIME, FRANCE_REGIME];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Attribuer un régime' }));
    expect(within(dialog()).queryByRole('radiogroup', { name: 'Régime' })).toBeNull();
    const select = within(dialog()).getByRole('combobox', { name: 'Régime' });
    expect(
      within(openList(select))
        .getAllByRole('option')
        .map((one) => one.textContent),
    ).toEqual([...versions.toReversed().map((one) => one.name), BENIN_REGIME.name]);
    fireEvent.keyDown(select, { key: 'Escape' });
    chooseValue(select, BENIN_REGIME.id);
    fireEvent.change(within(dialog()).getByLabelText('À partir du'), { target: { value: '2026-11-16' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes[0]?.body).toMatchObject({ regimeId: BENIN_REGIME.id, from: '2026-11-16' });
  });

  it('starts a new regime after the one set ahead, and sends the same key again after a lost answer', async () => {
    server.file = fileOf({
      regimes: [
        contractorRegimeOf(2, BENIN_DRAFT, '2026-12-01'),
        contractorRegimeOf(1, BENIN_REGIME, '2026-11-01'),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Attribuer un régime' }));
    const from = within(dialog()).getByLabelText('À partir du');
    expect(within(dialog()).getByDisplayValue('02/12/2026')).toBe(from);
    fireEvent.change(from, { target: { value: '2026-12-01' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    expect(
      within(dialog()).getByText('Après le régime déjà prévu, le 2 décembre 2026 au plus tôt.'),
    ).toBeTruthy();
    expect(server.writes).toEqual([]);

    fireEvent.change(from, { target: { value: '2027-01-01' } });
    server.refusal = { status: 503, code: 'unavailable' };
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    await within(dialog()).findByRole('alert');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Attribuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const [lost, again] = server.writes.map((one) => one.body);
    expect(again).toEqual(lost);
    expect(again).toMatchObject({ from: '2027-01-01' });
  });

  it('says a regime set ahead, and a member without any', async () => {
    server.file = fileOf({
      regimes: [
        contractorRegimeOf(2, BENIN_DRAFT, '2026-12-01'),
        contractorRegimeOf(1, BENIN_REGIME, '2026-11-01'),
      ],
    });
    renderPage();
    await screen.findByText('À partir du 1er décembre 2026 : Prestataire Bénin, version 2.');
    cleanup();
    server.file = fileOf({ regimes: [] });
    renderPage();
    await screen.findByText(
      'Théo n’a aucun régime : aucune facture ne part en son nom avant que tu lui en attribues un.',
    );
    expect(
      screen.getByText(
        'Théo n’a pas encore de régime : attribue-lui celui de son pays pour voir les pièces qu’il demande.',
      ),
    ).toBeTruthy();
  });

  it('reviews a document once, a refusal with its reason', async () => {
    server.file = fileOf({ documents: [documentOf(1, { issuedOn: '2026-10-20', review: null })] });
    renderPage();
    const documents = await waitFor(() => panelOf('Ses pièces'));
    const certificate = await waitFor(() => {
      const item = within(documents).getByText('Attestation de résidence fiscale').closest('li');
      if (item === null) throw new Error('No certificate');
      return item;
    });
    expect(within(certificate).getByText('À examiner').className).toBe('rp-chip rp-chip--warn');
    // The owner files nothing in the member's name.
    expect(within(certificate).queryByRole('button', { name: /Déposer/u })).toBeNull();
    expect(within(certificate).queryByText('Comment obtenir ton attestation')).toBeNull();

    fireEvent.click(within(certificate).getByRole('button', { name: 'Examiner' }));
    expect(within(dialog()).getByRole('link', { name: 'Ouvrir le fichier' }).getAttribute('href')).toBe(
      `/v1/payroll/contractors/${THEO.id}/documents/${documentOf(1).id}/file`,
    );
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Refuser' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Refuser' }));
    expect(within(dialog()).getByText(/^Le motif est obligatoire/u)).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText('Motif'), {
      target: { value: '  L’année n’est pas lisible.  ' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes).toEqual([
      expect.objectContaining({
        path: `/v1/payroll/contractors/${THEO.id}/documents/${documentOf(1).id}/review`,
        body: { decision: 'refused', reason: 'L’année n’est pas lisible.' },
      }),
    ]);
  });

  it('only reads the owner’s own file: no check, no review, no regime given', async () => {
    const own = TeamMemberSchema.parse({ ...IRIS, userId: OWNER_USER });
    server.members = [own];
    server.file = fileOf({
      memberId: own.id,
      profile: profileOf({ memberId: own.id, verifiedAt: null }),
      documents: [documentOf(1, { memberId: own.id, review: null })],
    });
    renderPage(own.id);
    await screen.findByText('C’est ton propre dossier : tu ne le vérifies pas, ni tes pièces.');
    const identity = panelOf('Son dossier');
    expect(within(identity).getByText('En attente de vérification')).toBeTruthy();
    expect(within(identity).queryByRole('button', { name: 'Vérifier' })).toBeNull();
    expect(screen.queryByLabelText('Préfixe des factures')).toBeNull();
    await waitFor(() => panelOf('Ses pièces'));
    expect(screen.queryByRole('button', { name: 'Examiner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attribuer un régime' })).toBeNull();
  });

  it('says a member that does not exist', async () => {
    renderPage('0199f2a0-0000-7000-8000-000000000099');
    await screen.findByText('Ce membre n’existe pas, ou plus.');
  });
});
