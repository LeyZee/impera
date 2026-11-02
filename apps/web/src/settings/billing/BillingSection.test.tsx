// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingSection } from './BillingSection';

/* An invented agency and logo (ADR 0010): 123 456 782 carries a right Luhn key, FR11 is its VAT key. */
const SHA = 'b'.repeat(64);
const LOGO = { sha256: SHA, mediaType: 'image/png', width: 1_200, height: 340, byteLength: 120_000 };
const SETTINGS = {
  agency: {
    legalName: 'Atelier Lumen',
    address: '12 rue des Exemples\n69002 Lyon',
    siren: '123456782',
    vatNumber: 'FR11123456782',
    legalForm: 'SAS',
    shareCapitalMinor: 1_000_000,
    rcsCity: 'Lyon',
  },
  paymentTerms:
    'Aucun escompte pour paiement anticipé. Pénalités : trois fois le taux légal. Indemnité : 40 €.',
  dueDays: 60,
  documentReminderDays: 30,
  fiscalYearEndMonth: 12,
  serviceDescription: 'Prestations de messagerie pour le compte de l’agence.',
  logoSha256: SHA,
  accounts: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
};

type Answer = { status: number; body: unknown } | 'down';

let view: { settings: unknown; logo: unknown } | 'down';
let onPut: Answer;
let onLogo: Answer;
/** While set, the server is still reading the logo sent: its answer waits for this. */
let hold: Promise<void> | null;
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (answer: Answer) =>
        answer === 'down'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
      if (init?.method === 'PUT' || init?.method === 'POST') {
        writes.push({
          method: init.method,
          path: url.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
        });
        if (init.method === 'PUT') return json(onPut);
        return hold === null ? json(onLogo) : hold.then(() => json(onLogo));
      }
      if (url.pathname === '/v1/payroll/billing-settings') {
        return json(view === 'down' ? { status: 500, body: null } : { status: 200, body: view });
      }
      return json({ status: 404, body: null });
    }),
  );
}

function renderSection(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BillingSection />
    </QueryClientProvider>,
  );
}

const refused = (code: string, details: Record<string, unknown> = {}): Answer => ({
  status: code.endsWith('_not_found') ? 404 : 400,
  body: { error: { code, message: 'Refusé', details, requestId: 'req-1' } },
});

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const next = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
};
const pick = (bytes: number): void => {
  const file = new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Fichier du logo'), { target: { files: [file] } });
};

beforeEach(() => {
  writes.length = 0;
  view = { settings: SETTINGS, logo: LOGO };
  onPut = { status: 200, body: { settings: SETTINGS, logo: LOGO } };
  onLogo = { status: 201, body: LOGO };
  hold = null;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Facturation', () => {
  it('asks for the settings first while none is saved, then walks the six steps and saves them whole', async () => {
    view = { settings: null, logo: null };
    renderSection();
    expect(await screen.findByText('Aucune facture ne part')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remplir les réglages' }));

    const dialog = screen.getByRole('dialog', { name: 'Réglages de facturation' });
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1L’agence', '2Immatriculation', '3Prestation', '4Paiement', '5Rappel des pièces', '6Logo']);
    // Nothing goes on with an empty step: each field says what it wants, the focus on the first.
    next();
    expect(screen.getByText('La raison sociale, telle que sur le Kbis.')).toBeDefined();
    expect(screen.getByText('Le capital social en euros, par exemple 1 000.')).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Raison sociale'));
    });
    type('Raison sociale', 'Atelier Lumen');
    type('Forme juridique', 'SAS');
    type('Capital social', '10 000');
    type('Adresse du siège', '12 rue des Exemples\n69002 Lyon');
    next();

    type('SIREN', '123 456 789');
    type('Ville du RCS', 'Lyon');
    type('TVA intracommunautaire', 'FR11123456782');
    next();
    expect(screen.getByText('Neuf chiffres, ceux du Kbis : ceux-ci ne forment pas un SIREN.')).toBeDefined();
    type('SIREN', '123 456 782');
    // The VAT number computed from the SIREN is offered while the field is empty.
    type('TVA intracommunautaire', '');
    fireEvent.click(screen.getByRole('button', { name: 'Le reprendre' }));
    expect(screen.getByLabelText<HTMLInputElement>('TVA intracommunautaire').value).toBe('FR11123456782');
    fireEvent.change(screen.getByLabelText('Clôture de l’exercice'), { target: { value: '6' } });
    next();

    type('Désignation de la prestation', 'Prestations de messagerie pour le compte de l’agence.');
    next();

    // No payment terms are written for the owner: the hint says what they must say.
    expect(screen.getByLabelText<HTMLTextAreaElement>('Conditions de paiement').value).toBe('');
    expect(screen.getByText(/au moins trois fois le taux d’intérêt légal/u)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Échéance').value).toBe('60');
    type('Conditions de paiement', SETTINGS.paymentTerms);
    next();

    // The reminder of the documents: 30 days ahead unless changed, 1 to 120.
    expect(screen.getByLabelText<HTMLInputElement>('Rappel des pièces').value).toBe('30');
    type('Rappel des pièces', '0');
    next();
    expect(screen.getByText('Un nombre entier de jours, de 1 à 120.')).toBeDefined();
    type('Rappel des pièces', '45');
    next();

    expect(screen.getByText('Aucun logo : la facture imprime la raison sociale seule.')).toBeDefined();
    pick(120_000);
    expect(await screen.findByText('1 200 × 340 px · 117 Ko')).toBeDefined();
    expect(writes[0]).toMatchObject({ method: 'POST', path: '/v1/payroll/billing-settings/logos' });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes[1]).toEqual({
      method: 'PUT',
      path: '/v1/payroll/billing-settings',
      body: {
        agency: SETTINGS.agency,
        serviceDescription: SETTINGS.serviceDescription,
        paymentTerms: SETTINGS.paymentTerms,
        dueDays: 60,
        documentReminderDays: 45,
        fiscalYearEndMonth: 6,
        logoSha256: SHA,
      },
    });
    // The page shows what the server answered.
    expect(screen.getByRole('heading', { name: 'L’agence' })).toBeDefined();
    expect(screen.queryByText('Aucune facture ne part')).toBeNull();
  });

  it('shows what each invoice prints, the foot as the PDF writes it', async () => {
    renderSection();
    expect(await screen.findByText('Atelier Lumen')).toBeDefined();
    expect(screen.getByText('SAS au capital de 10 000 €')).toBeDefined();
    expect(screen.getByText('123 456 782')).toBeDefined();
    expect(screen.getByText('31 décembre')).toBeDefined();
    // Under the total in Paiement, and among the delays.
    expect(screen.getAllByText('60 jours après l’émission')).toHaveLength(2);
    expect(
      screen.getByText(
        'Document établi par Atelier Lumen, 12 rue des Exemples, 69002 Lyon · SAS au capital de 10 000 € · ' +
          'RCS Lyon 123 456 782, mandataire de facturation du prestataire.',
      ),
    ).toBeDefined();
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Logo de Atelier Lumen' }).src).toMatch(
      new RegExp(`/v1/payroll/billing-settings/logos/${SHA}$`, 'u'),
    );
    expect(screen.getByText('1 200 × 340 px · 117 Ko')).toBeDefined();
    // Nothing is missing: no notice, no bright button on the page.
    expect(screen.queryByText('Aucune facture ne part')).toBeNull();
    expect(document.querySelector('.nv-btn--neon')).toBeNull();
  });

  it('changes one card in its own step and still sends the whole settings', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer : Paiement' }));
    const dialog = screen.getByRole('dialog', { name: 'Paiement' });
    expect(within(dialog).queryByRole('list', { name: 'Étapes' })).toBeNull();
    type('Échéance', '30');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Un nombre entier de jours, de 45 à 60.')).toBeDefined();
    expect(writes).toEqual([]);
    type('Échéance', '45');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toEqual([
      {
        method: 'PUT',
        path: '/v1/payroll/billing-settings',
        body: {
          agency: SETTINGS.agency,
          serviceDescription: SETTINGS.serviceDescription,
          paymentTerms: SETTINGS.paymentTerms,
          dueDays: 45,
          documentReminderDays: 30,
          fiscalYearEndMonth: 12,
          logoSha256: SHA,
        },
      },
    ]);
  });

  it('opens with a card the steps a copy made before the foot lacks', async () => {
    view = {
      settings: { ...SETTINGS, agency: { ...SETTINGS.agency, legalForm: null, rcsCity: null } },
      logo: LOGO,
    };
    renderSection();
    expect(await screen.findAllByText('À remplir')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Changer : Logo' }));
    const dialog = screen.getByRole('dialog', { name: 'Logo' });
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1L’agence', '2Immatriculation', '3Logo']);
    expect(screen.getByText('La forme juridique, par exemple SAS ou SARL.')).toBeDefined();
  });

  it('says why a logo is refused, refuses a heavy one without sending it, and prints none on demand', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer : Logo' }));

    pick(600 * 1024);
    expect(await screen.findByText(/Ce fichier pèse plus de 512 Ko/u)).toBeDefined();
    expect(writes).toEqual([]);

    onLogo = refused('agency_logo_invalid', { reason: 'opaque' });
    pick(4_000);
    expect(await screen.findByText(/aucun pixel transparent/u)).toBeDefined();
    expect(writes).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ne pas imprimer de logo' }));
    expect(screen.getByText('Aucun logo : la facture imprime la raison sociale seule.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    expect(writes[1]).toMatchObject({ method: 'PUT', body: { logoSha256: null } });
  });

  it('saves nothing while the server reads a logo, then keeps it and gives the focus back to the picker', async () => {
    let release = (): void => undefined;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    const fresh = { ...LOGO, sha256: 'c'.repeat(64) };
    onLogo = { status: 201, body: fresh };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer : Logo' }));

    pick(4_000);
    expect(await screen.findByRole('button', { name: 'Lecture du fichier…' })).toHaveProperty(
      'disabled',
      true,
    );
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toHaveProperty('disabled', true);
    // Not by the keyboard either: Entrée submits the form.
    const form = save.closest('form');
    expect(form).not.toBeNull();
    if (form !== null) fireEvent.submit(form);
    expect(writes.map((write) => write.method)).toEqual(['POST']);

    release();
    const picker = await screen.findByRole('button', { name: 'Choisir un autre PNG' });
    expect(picker).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(picker);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    expect(writes[1]).toMatchObject({ method: 'PUT', body: { logoSha256: fresh.sha256 } });
  });

  it('warns that a short logo may print blurry, without refusing it', async () => {
    view = { settings: SETTINGS, logo: { ...LOGO, height: 120 } };
    renderSection();
    expect(await screen.findByText(/il risque d’être flou à l’impression/u)).toBeDefined();
  });

  it('keeps the form open and says it when the server refuses or does not answer', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer : Désignation de la prestation' }));
    onPut = 'down';
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findByText(
        'Le serveur ne répond pas : rien n’a été enregistré. Réessaie dans un instant.',
      ),
    ).toBeDefined();
    onPut = refused('agency_logo_not_found');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/ne trouve plus ce logo/u)).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('says a server that does not answer, and reads again on demand', async () => {
    view = 'down';
    renderSection();
    expect(await screen.findByText('Le serveur ne répond pas', {}, { timeout: 3_000 })).toBeDefined();
    view = { settings: SETTINGS, logo: LOGO };
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Atelier Lumen')).toBeDefined();
  });
});
