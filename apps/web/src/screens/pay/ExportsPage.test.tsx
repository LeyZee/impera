// @vitest-environment jsdom
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

import { ExportsPage } from './ExportsPage';

import { BILLING_SETTINGS } from '@/test/billing';
import { MEMBERS, OCT1, OCT2, OWNER, SCHEDULING_SETTINGS, THEO, LOU } from '@/test/pay';
import { choose } from '@/test/select';

/*
 * The journal's bytes as the API makes them: ISO 8859-15, where « € » is 0xA4, « é » 0xE9 and « œ » 0xBD, lines ended
 * by CRLF. Read as text, any of them would change; the file saved must be these bytes, one for one.
 */
const JOURNAL_BYTES = Uint8Array.from([
  0x4a, 0x6f, 0x75, 0x72, 0x6e, 0x61, 0x6c, 0x09, 0xa4, 0xe9, 0xbd, 0x0d, 0x0a, 0x41, 0x43, 0x48, 0x09, 0x31,
  0x32, 0x2c, 0x35, 0x30, 0x0d, 0x0a,
]);
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const JOURNAL = {
  fileName: 'journal-prestataires_20260101_20261105.txt',
  mediaType: 'text/plain; charset=ISO-8859-15',
  content: base64(JOURNAL_BYTES),
  entryCount: 14,
  unbalanced: [{ prefix: 'NORA', period: OCT1 }],
  transfersLeftOut: [{ memberId: LOU.id, period: OCT2 }],
};

const CSV_BYTES = Uint8Array.from([0xef, 0xbb, 0xbf, 0x4e, 0x6f, 0x6d, 0x3b, 0x4d, 0x0d, 0x0a]);
const DAS2 = {
  year: 2025,
  fileName: 'das2-prestataires_2025.csv',
  mediaType: 'text/csv; charset=utf-8',
  content: base64(CSV_BYTES),
  beneficiaries: [
    {
      memberId: THEO.id,
      identity: { legalName: 'Théo Exemple', address: 'Cotonou', country: 'BJ', taxId: 'IFU-0001' },
      nature: 'commissions',
      paidMinor: 312_450,
      treatyExemptMinor: 280_000,
      warnings: ['profile_changed', 'transfer_without_invoice'],
    },
    {
      memberId: LOU.id,
      identity: null,
      nature: 'commissions',
      paidMinor: 250_100,
      treatyExemptMinor: 0,
      warnings: ['identity_missing'],
    },
  ],
  notes: ['amounts_as_sent'],
};

const ZIP_BYTES = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x01]);

interface Answer {
  readonly status: number;
  readonly body: unknown;
}
let journal: Answer;
let das2: Answer;
let archive: Answer | 'zip';
let settings: unknown;
const reads: string[] = [];
const saved: { readonly name: string; readonly blob: Blob }[] = [];
let lastBlob: Blob | null = null;

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      switch (url.pathname) {
        case '/v1/payroll/accounting/journal':
          reads.push(`${url.pathname}${url.search}`);
          return json(journal.body, journal.status);
        case '/v1/payroll/accounting/das2':
          reads.push(`${url.pathname}${url.search}`);
          return json(das2.body, das2.status);
        case '/v1/payroll/accounting/archive':
          reads.push(`${url.pathname}${url.search}`);
          return archive === 'zip'
            ? Promise.resolve(
                new Response(ZIP_BYTES, {
                  status: 200,
                  headers: {
                    'content-type': 'application/zip',
                    'content-disposition': 'attachment; filename="pieces-prestataires_20260101_20261105.zip"',
                  },
                }),
              )
            : json(archive.body, archive.status);
        case '/v1/payroll/billing-settings':
          return json({ settings, logo: null });
        case '/v1/team/members':
          return json({ members: MEMBERS });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/exports',
    component: () => <ExportsPage user={OWNER} />,
  });
  const billing = createRoute({
    getParentRoute: () => root,
    path: '/reglages/facturation',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, billing]),
    history: createMemoryHistory({ initialEntries: ['/paie/exports'] }),
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

const bytesOf = async (blob: Blob): Promise<number[]> => Array.from(new Uint8Array(await blob.arrayBuffer()));

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  journal = { status: 200, body: JOURNAL };
  das2 = { status: 200, body: DAS2 };
  archive = 'zip';
  settings = BILLING_SETTINGS;
  reads.length = 0;
  saved.length = 0;
  lastBlob = null;
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL(blob: Blob): string {
        lastBlob = blob;
        return 'blob:export';
      }
      static override revokeObjectURL(): void {
        // Kept: the test reads the bytes after the save.
      }
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function save(this: HTMLAnchorElement) {
    if (lastBlob !== null) saved.push({ name: this.download, blob: lastBlob });
  });
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Paie › Exports', () => {
  it('saves the journal’s ISO 8859-15 bytes one for one, and says in amber what it left aside', async () => {
    renderPage();
    const panel = await waitFor(() => panelOf('Journal des prestataires'));
    // The fiscal year in progress by default: the calendar year, as the settings close it in December.
    expect(within(panel).getByLabelText('Du')).toHaveProperty('value', '2026-01-01');
    expect(within(panel).getByLabelText('Au')).toHaveProperty('value', '2026-11-05');
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer le journal' }));
    await within(panel).findByText(JOURNAL.fileName);
    expect(reads).toEqual(['/v1/payroll/accounting/journal?from=2026-01-01&to=2026-11-05']);
    expect(within(panel).getByText('14 écritures')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Télécharger le journal' }));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe(JOURNAL.fileName);
    expect(saved[0]?.blob.type).toBe('text/plain; charset=iso-8859-15');
    expect(await bytesOf(saved[0]?.blob ?? new Blob())).toEqual(Array.from(JOURNAL_BYTES));

    const unlettered = within(panel).getByText('Un groupe reste sans lettre').closest('.rp-notice');
    expect(unlettered?.getAttribute('data-tone')).toBe('warn');
    expect(unlettered?.textContent).toContain('NORA, relevé du 1er au 15 octobre 2026');
    const left = within(panel).getByText('Un virement reste hors du fichier').closest('.rp-notice');
    expect(left?.getAttribute('data-tone')).toBe('warn');
    expect(left?.textContent).toContain('Lou, quinzaine du 16 au 31 octobre 2026');
  });

  it('names the accounts the accountant has not given, and leads to Réglages › Facturation', async () => {
    journal = {
      status: 422,
      body: {
        error: {
          code: 'journal_accounts_missing_unprocessable',
          message: 'missing',
          details: { missing: ['vatSelfAssessedDue', 'bankJournal'] },
          requestId: 'r1',
        },
      },
    };
    renderPage();
    const panel = await waitFor(() => panelOf('Journal des prestataires'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer le journal' }));
    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain(
      'Il manque 2 comptes du journal : TVA autoliquidée due et journal de banque.',
    );
    expect(within(alert).getByRole('link', { name: 'Réglages › Facturation' }).getAttribute('href')).toBe(
      '/reglages/facturation',
    );
  });

  it('says the contract’s reason for a period it refuses, and sends nothing', async () => {
    settings = { ...BILLING_SETTINGS, fiscalYearEndMonth: 6 };
    renderPage();
    const panel = await waitFor(() => panelOf('Journal des prestataires'));
    // A fiscal year closing in June: the one in progress began on the 1st of July.
    await waitFor(() => {
      expect(within(panel).getByLabelText('Du')).toHaveProperty('value', '2026-07-01');
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Exercice précédent' }));
    expect(within(panel).getByLabelText('Du')).toHaveProperty('value', '2025-07-01');
    expect(within(panel).getByLabelText('Au')).toHaveProperty('value', '2026-06-30');

    fireEvent.change(within(panel).getByLabelText('Du'), { target: { value: '2024-01-01' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer le journal' }));
    expect(within(panel).getByText('Deux ans au plus.')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Du'), { target: { value: '2026-07-01' } });
    expect(within(panel).getByText('La fin suit le début.')).toBeTruthy();
    expect(reads).toEqual([]);
  });

  it('shows the DAS2’s beneficiaries in clear, their warnings in amber, and saves the CSV as it came', async () => {
    renderPage();
    const panel = await waitFor(() => panelOf('Récapitulatif DAS2'));
    // The year just ended first: it is the one declared in the spring.
    expect(within(panel).getByRole('combobox', { name: 'Année des virements' }).textContent).toBe('2025');
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer le récapitulatif' }));
    await within(panel).findByText(DAS2.fileName);
    expect(reads).toEqual(['/v1/payroll/accounting/das2?year=2025']);
    const text = panel.textContent.replace(/[\u00a0\u202f]/gu, ' ');
    expect(text).toContain('Montants partis');
    expect(text).toContain('3 124,50 €');
    expect(text).toContain('2 800,00 €');
    const theo = within(panel).getByText('Théo Exemple').closest('tr');
    if (theo === null) throw new Error('No row');
    expect(within(theo).getByText('Dossier changé depuis').className).toBe('rp-chip rp-chip--warn');
    expect(within(theo).getByText('Virement sans facture').className).toBe('rp-chip rp-chip--warn');
    // Without an identity, the member's name and the warning that says why.
    const lou = within(panel).getByText('Commissions, sans identité').closest('tr');
    if (lou === null) throw new Error('No row');
    expect(within(lou).getByText('Lou')).toBeTruthy();
    expect(within(lou).getByText('Identité absente')).toBeTruthy();
    const legend = within(panel).getByText('À vérifier avec le comptable').closest('.rp-notice');
    expect(legend?.getAttribute('data-tone')).toBe('warn');
    expect(legend?.querySelectorAll('li')).toHaveLength(3);

    fireEvent.click(within(panel).getByRole('button', { name: 'Télécharger le CSV' }));
    expect(saved[0]?.name).toBe(DAS2.fileName);
    expect(await bytesOf(saved[0]?.blob ?? new Blob())).toEqual(Array.from(CSV_BYTES));
  });

  it('says a year without a beneficiary', async () => {
    das2 = {
      status: 200,
      body: { ...DAS2, year: 2024, fileName: 'das2-prestataires_2024.csv', beneficiaries: [] },
    };
    renderPage();
    const panel = await waitFor(() => panelOf('Récapitulatif DAS2'));
    choose(within(panel).getByRole('combobox', { name: 'Année des virements' }), '2024');
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer le récapitulatif' }));
    expect(
      (await within(panel).findByText(/^Personne n’a reçu plus de 2/u)).textContent.replace(
        /[\u00a0\u202f]/gu,
        ' ',
      ),
    ).toBe('Personne n’a reçu plus de 2 400 € en 2024 : aucune ligne à déclarer.');
    expect(reads).toEqual(['/v1/payroll/accounting/das2?year=2024']);
  });

  it('saves the archive’s stream as one file under the server’s name, without opening it', async () => {
    renderPage();
    const panel = await waitFor(() => panelOf('Archive des PDF'));
    expect(panel.textContent).toContain('manifeste.csv');
    expect(panel.textContent).toContain('« hébergeurs injoignables » n’abîme rien : relance l’export.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Préparer l’archive' }));
    await within(panel).findByText('pieces-prestataires_20260101_20261105.zip');
    expect(reads).toEqual(['/v1/payroll/accounting/archive?from=2026-01-01&to=2026-11-05']);
    expect(within(panel).getByText(/^1\sKo$/u)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Télécharger l’archive' }));
    expect(saved[0]?.name).toBe('pieces-prestataires_20260101_20261105.zip');
    expect(saved[0]?.blob.type).toBe('application/zip');
    expect(await bytesOf(saved[0]?.blob ?? new Blob())).toEqual(Array.from(ZIP_BYTES));
  });

  it('says a server that does not answer, and a role it refuses', async () => {
    archive = {
      status: 503,
      body: { error: { code: 'unavailable', message: 'down', details: {}, requestId: 'r2' } },
    };
    das2 = {
      status: 403,
      body: { error: { code: 'payroll_forbidden', message: 'owner', details: {}, requestId: 'r3' } },
    };
    renderPage();
    const files = await waitFor(() => panelOf('Archive des PDF'));
    fireEvent.click(within(files).getByRole('button', { name: 'Préparer l’archive' }));
    expect((await within(files).findByRole('alert')).textContent).toBe(
      'Le serveur ne répond pas : aucun fichier n’est prêt. Réessaie.',
    );
    const recap = panelOf('Récapitulatif DAS2');
    fireEvent.click(within(recap).getByRole('button', { name: 'Préparer le récapitulatif' }));
    expect((await within(recap).findByRole('alert')).textContent).toBe(
      'Seul le propriétaire télécharge les exports.',
    );
  });
});
