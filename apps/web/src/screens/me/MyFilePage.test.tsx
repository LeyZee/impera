// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
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

import { MyFilePage } from './MyFilePage';

import {
  acceptanceOf,
  BENIN_REGIME,
  CONTRACT_V1,
  contractorRegimeOf,
  documentOf,
  fileOf,
  fileServer,
  FRANCE_REGIME,
  MANDATE_V1,
  MANDATE_V2,
  profileOf,
  serveFile,
  type FileServer,
} from '@/test/contractors';
import { IRIS, IRIS_ME, THEO, THEO_ME } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;

let server: FileServer;

function renderPage(user: Me = THEO_ME): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/dossier',
    component: () => <MyFilePage user={user} />,
  });
  const invoices = createRoute({ getParentRoute: () => root, path: '/moi/factures', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, invoices]),
    history: createMemoryHistory({ initialEntries: ['/moi/dossier'] }),
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

const itemOf = (panel: HTMLElement, name: string): HTMLElement => {
  const item = within(panel).getByText(name).closest('li');
  if (item === null) throw new Error(`No item ${name}`);
  return item;
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

describe('Moi › Dossier', () => {
  it('asks an empty file to be filled, with the fields of his country, and sends it', async () => {
    server.file = fileOf({ profile: null, regimes: [] });
    renderPage();
    await screen.findByText('Ton dossier est vide.');
    // A chatter's Moi holds one screen: no sub-tabs.
    expect(screen.queryByRole('link', { name: 'Factures' })).toBeNull();
    // At the panel's inset, never against its rounded edge (recette 05/11, CHAT-16).
    expect(
      within(panelOf('Tes pièces'))
        .getByText(/Aucun régime de facturation pour l’instant/u)
        .closest('.rp-sec'),
    ).not.toBeNull();
    expect(
      within(panelOf('Tes textes')).getByText('Contrat de prestation').closest('.rp-sec'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remplir mon dossier' }));
    expect(within(dialog()).getByText(/Pays : Bénin/u)).toBeTruthy();
    expect(within(dialog()).queryByLabelText('SIREN ou SIRET')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Enregistrer' }));
    expect(
      within(dialog()).getByText('Ton nom et ton prénom, tels que sur ta pièce d’identité.'),
    ).toBeTruthy();
    expect(server.writes).toEqual([]);

    fireEvent.change(within(dialog()).getByLabelText('Nom'), { target: { value: 'Théo Exemple' } });
    fireEvent.change(within(dialog()).getByLabelText('Adresse'), {
      target: { value: 'Rue 12\nCotonou' },
    });
    fireEvent.change(within(dialog()).getByLabelText('E-mail des factures'), {
      target: { value: 'theo@example.test' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes.map((one) => [one.method, one.path])).toEqual([
      ['PUT', `/v1/payroll/contractors/${THEO.id}/profile`],
    ]);
    expect(server.writes[0]?.body).toMatchObject({
      legalName: 'Théo Exemple',
      address: 'Rue 12\nCotonou',
      taxId: null,
      businessId: null,
      email: 'theo@example.test',
    });
  });

  it('shows his identity as his invoices print it, waiting for the owner’s check', async () => {
    server.file = fileOf({ profile: profileOf({ verifiedAt: null }) });
    renderPage();
    const identity = await waitFor(() => panelOf('Ton dossier'));
    expect(within(identity).getByText('En attente de vérification').className).toBe('rp-chip rp-chip--wait');
    expect(within(identity).getByText('Théo Exemple')).toBeTruthy();
    expect(within(identity).getByText('Rue 12, quartier Exemple, Cotonou')).toBeTruthy();
    expect(within(identity).getByText('THEO')).toBeTruthy();
    fireEvent.click(within(identity).getByRole('button', { name: 'Modifier' }));
    // His regime asks for his tax identifier: the field says so.
    expect(within(dialog()).getByText('Ton régime le demande. Au Bénin, ton IFU.')).toBeTruthy();
    expect(within(dialog()).queryByText(/repasse par la vérification/u)).toBeNull();
  });

  it('asks a new version of the mandate to be read and accepted, with its fingerprint', async () => {
    server.texts = [MANDATE_V2, MANDATE_V1, CONTRACT_V1];
    server.file = fileOf({
      acceptances: [
        acceptanceOf(1, MANDATE_V1, '2026-10-30T10:00:00.000Z'),
        acceptanceOf(2, CONTRACT_V1, '2026-10-30T10:01:00.000Z'),
      ],
    });
    renderPage();
    const texts = await waitFor(() => panelOf('Tes textes'));
    const contract = await waitFor(() => itemOf(texts, 'Contrat de prestation'));
    expect(contract.textContent).toContain('Version 1, acceptée le 30 octobre 2026');
    expect(within(contract).getByText('Accepté').className).toBe('rp-chip rp-chip--ok');
    const mandate = itemOf(texts, 'Mandat de facturation');
    expect(mandate.textContent.replace(NBSP, ' ')).toContain(
      'Version 2, nouvelle : tu avais accepté la version 1 le 30 octobre 2026.',
    );
    expect(within(mandate).getByText('À accepter').className).toBe('rp-chip rp-chip--warn');

    fireEvent.click(within(mandate).getByRole('button', { name: 'Lire et accepter' }));
    expect(within(dialog()).getByLabelText('Texte').textContent).toContain('version 2');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'J’accepte la version 2' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: `/v1/payroll/contract-texts/${MANDATE_V2.id}/accept`,
        body: { sha256: MANDATE_V2.sha256 },
      }),
    ]);
  });

  it('files the document his regime asks for, the same key on a retry of the same file', async () => {
    renderPage();
    const documents = await waitFor(() => panelOf('Tes pièces'));
    const certificate = await waitFor(() => itemOf(documents, 'Attestation de résidence fiscale'));
    expect(within(certificate).getByText('À envoyer').className).toBe('rp-chip rp-chip--warn');
    // The guide of Benin, under his certificate.
    expect(within(certificate).getByText('Comment obtenir ton attestation')).toBeTruthy();

    fireEvent.click(within(certificate).getByRole('button', { name: 'Déposer' }));
    const file = new File(['%PDF-1.7'], 'attestation.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog()).getByLabelText('Le fichier'), { target: { files: [file] } });
    // A tax residence certificate holds for its year: no end to type.
    expect(within(dialog()).queryByLabelText(/Valable jusqu’au/u)).toBeNull();
    fireEvent.change(within(dialog()).getByLabelText('Délivrée le'), { target: { value: '2026-12-01' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Déposer' }));
    expect(within(dialog()).getByText('La date écrite sur la pièce, au plus tard aujourd’hui.')).toBeTruthy();
    expect(server.writes).toEqual([]);

    fireEvent.change(within(dialog()).getByLabelText('Délivrée le'), { target: { value: '2026-10-20' } });
    server.refusal = { status: 503, code: 'unavailable' };
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Déposer' }));
    await within(dialog()).findByRole('alert');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Déposer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(server.writes).toHaveLength(2);
    const [first, second] = server.writes;
    expect(first?.path).toBe(`/v1/payroll/contractors/${THEO.id}/documents`);
    expect(first?.body).toEqual({ bytes: file.size });
    expect(first?.search.get('kind')).toBe('tax_residence');
    expect(first?.search.get('issuedOn')).toBe('2026-10-20');
    expect(first?.search.has('validUntil')).toBe(false);
    expect(second?.search.get('id')).toBe(first?.search.get('id'));
  });

  it('reminds the renewal of his certificate from the 1st of December, in amber', async () => {
    server.file = fileOf({
      today: '2026-12-02',
      documents: [
        documentOf(2, {
          issuedOn: '2026-11-20',
          review: { decision: 'refused', reason: 'Illisible', reviewedAt: '2026-11-21T09:00:00.000Z' },
          remindFrom: null,
          purgedAt: '2026-11-25T09:00:00.000Z',
        }),
        documentOf(1),
      ],
    });
    renderPage();
    const documents = await waitFor(() => panelOf('Tes pièces'));
    const certificate = await waitFor(() => itemOf(documents, 'Attestation de résidence fiscale'));
    expect(certificate.dataset['remind']).toBe('true');
    expect(
      within(certificate).getByText(/^Ton attestation se termine le 31 décembre/u).textContent,
    ).toContain('Sans celle de 2027');
    expect(within(certificate).getByText('Acceptée').className).toBe('rp-chip rp-chip--ok');
    expect(within(certificate).getByRole('button', { name: 'Déposer une nouvelle' })).toBeTruthy();
    // The refused one stays kept under it, its reason said, its file erased.
    const older = within(certificate).getByText('Une pièce précédente').closest('details');
    if (older === null) throw new Error('No older documents');
    expect(within(older).getByText('Motif : « Illisible »')).toBeTruthy();
    expect(within(older).getByText('Fichier effacé')).toBeTruthy();
  });

  it('says a certificate past its year expired in amber, and what it blocks now', async () => {
    server.file = fileOf({ today: '2027-01-04', documents: [documentOf(1)] });
    renderPage();
    const documents = await waitFor(() => panelOf('Tes pièces'));
    const certificate = await waitFor(() => itemOf(documents, 'Attestation de résidence fiscale'));
    expect(within(certificate).getByText('Échue').className).toBe('rp-chip rp-chip--warn');
    expect(within(certificate).queryByText('Acceptée')).toBeNull();
    expect(certificate.textContent).toContain('Acceptée, échue le 31 décembre 2026');
    expect(certificate.dataset['remind']).toBe('true');
    expect(
      within(certificate).getByText(/^Ton attestation de 2026 s’est terminée le 31 décembre 2026\./u)
        .textContent,
    ).toContain('Tes versements sont bloqués jusqu’à ce que celle de 2027 soit acceptée');
  });

  it('says only a warning on his invoices, and no guide, under a regime without a treaty', async () => {
    // A regime the accountant could write: no withholding due, the certificate asked all the same.
    const withoutTreaty = { ...BENIN_REGIME, id: FRANCE_REGIME.id, withholding: 'none' as const };
    server.regimes = [withoutTreaty];
    server.file = fileOf({
      today: '2027-01-04',
      regimes: [contractorRegimeOf(1, withoutTreaty, '2026-11-01')],
      documents: [documentOf(1)],
    });
    renderPage();
    const documents = await waitFor(() => panelOf('Tes pièces'));
    const certificate = await waitFor(() => itemOf(documents, 'Attestation de résidence fiscale'));
    expect(
      within(certificate).getByText(
        'Ton attestation de 2026 s’est terminée le 31 décembre 2026 : dépose celle de 2027. Tes factures partent avec un avertissement en attendant.',
      ),
    ).toBeTruthy();
    expect(certificate.textContent).not.toContain('versements');
    // The guide says the money cannot leave without it: not shown where it can.
    expect(within(certificate).queryByText('Comment obtenir ton attestation')).toBeNull();
  });

  it('gives a manager his two screens of Moi', async () => {
    server.members = [IRIS];
    server.file = fileOf({
      memberId: IRIS.id,
      country: 'FR',
      profile: null,
      regimes: [contractorRegimeOf(2, FRANCE_REGIME, '2026-11-01', IRIS)],
    });
    server.regimes = [FRANCE_REGIME, BENIN_REGIME];
    renderPage(IRIS_ME);
    await screen.findByText('Ton dossier est vide.');
    expect(screen.getByRole('link', { name: 'Factures' }).getAttribute('href')).toBe('/moi/factures');
    const vigilance = await waitFor(() => itemOf(panelOf('Tes pièces'), 'Attestation de vigilance'));
    expect(within(vigilance).queryByText('Comment obtenir ton attestation')).toBeNull();
  });

  it('says when his team record cannot be found', async () => {
    server.members = [];
    renderPage();
    await screen.findByText('Ta fiche d’équipe est introuvable : le propriétaire peut la vérifier.');
  });
});
