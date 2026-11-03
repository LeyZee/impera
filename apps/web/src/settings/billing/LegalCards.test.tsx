// @vitest-environment jsdom
import type { BillingRegime, ContractText } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingSection } from './BillingSection';

import { BILLING_SETTINGS } from '@/test/billing';
import {
  BENIN_DRAFT,
  BENIN_REGIME,
  CONTRACT_V1,
  FRANCE_REGIME,
  MANDATE_V1,
  MANDATE_V2,
} from '@/test/contractors';
import { SCHEDULING_SETTINGS } from '@/test/pay';

/* Réglages › Facturation, its second half (EQ-06 lot 8c): the journal's accounts, the delays, the texts, the regimes. */

interface Answer {
  readonly status: number;
  readonly body: unknown;
}
let texts: ContractText[];
let regimes: BillingRegime[];
let answer: Answer | null;
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'PUT' || init?.method === 'POST') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        writes.push({ method: init.method, path: url.pathname, body });
        if (answer !== null) {
          const once = answer;
          answer = null;
          return json(once.body, once.status);
        }
        if (url.pathname.endsWith('/accounts'))
          return json({ settings: { ...BILLING_SETTINGS, accounts: body }, logo: null });
        if (url.pathname.endsWith('/validation'))
          return json({ ...BENIN_DRAFT, validatedOn: '2026-11-04' }, 201);
        if (url.pathname === '/v1/payroll/billing-regimes') return json(BENIN_REGIME, 201);
        return json(MANDATE_V2, 201);
      }
      switch (url.pathname) {
        case '/v1/payroll/billing-settings':
          return json({ settings: BILLING_SETTINGS, logo: null });
        case '/v1/payroll/contract-texts':
          return json({ texts });
        case '/v1/payroll/billing-regimes':
          return json({ regimes });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        default:
          return json({ error: { code: 'not_found', message: 'none', details: {}, requestId: 'r' } }, 404);
      }
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

const cardOf = (title: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('.rp-account');
  if (!(card instanceof HTMLElement)) throw new Error(`No card ${title}`);
  return card;
};
const dialog = (): HTMLElement => screen.getByRole('dialog');
const type = (label: string, value: string): void => {
  fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  texts = [MANDATE_V1, CONTRACT_V1];
  regimes = [BENIN_DRAFT, BENIN_REGIME, FRANCE_REGIME];
  answer = null;
  writes.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Réglages › Facturation, comptes du journal', () => {
  it('shows eight empty accounts, proposes none, and sends those given, the others empty', async () => {
    renderSection();
    const card = await waitFor(() => cardOf('Comptes du journal'));
    expect(within(card).getAllByText('À donner')).toHaveLength(8);
    expect(within(card).getByText(/^Aucun compte encore/u).className).toBe('tm-hint cf-amber');

    fireEvent.click(within(card).getByRole('button', { name: 'Changer : Comptes du journal' }));
    for (const input of within(dialog()).getAllByRole('textbox')) expect(input).toHaveProperty('value', '');
    type('Fournisseurs (compte collectif)', '401 ');
    type('TVA déductible', '44566');
    type('TVA autoliquidée due', '44566');
    type('Journal des achats', 'ha');
    type('Journal de banque', 'HA');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Enregistrer' }));
    expect(
      within(dialog()).getByText('La TVA due ne va jamais sur un compte de TVA déductible.'),
    ).toBeTruthy();
    expect(
      within(dialog()).getByText('Le journal de banque a un autre code que celui des achats.'),
    ).toBeTruthy();
    expect(writes).toEqual([]);

    type('TVA autoliquidée due', '4452');
    type('Journal de banque', 'BQ');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toEqual([
      {
        method: 'PUT',
        path: '/v1/payroll/billing-settings/accounts',
        body: {
          expense: null,
          supplier: '401',
          vatDeductible: '44566',
          vatSelfAssessedDeductible: null,
          vatSelfAssessedDue: '4452',
          bank: null,
          purchaseJournal: 'HA',
          bankJournal: 'BQ',
        },
      },
    ]);
    // The page shows what the server answered: five given, three still asked.
    expect(within(cardOf('Comptes du journal')).getAllByText('À donner')).toHaveLength(3);
    expect(within(cardOf('Comptes du journal')).getByText(/^5 sur 8/u)).toBeTruthy();
  });
});

describe('Réglages › Facturation, délais', () => {
  it('says the three delays and where each is set, and changes the reminder in its own step', async () => {
    renderSection();
    const card = await waitFor(() => cardOf('Délais'));
    expect(card.textContent).toContain('30 jours avant sa fin');
    expect(card.textContent).toContain('L’attestation de résidence fiscale garde le 1er décembre.');
    expect(card.textContent).toContain('60 jours après l’émission');
    await waitFor(() => {
      expect(card.textContent).toContain('7 jours après l’émission');
    });
    expect(card.textContent).toContain(
      'Celui de la dernière version du mandat. Chaque prestataire garde celui de la version qu’il a acceptée, jusqu’à ce qu’il accepte la nouvelle.',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Changer : Délais' }));
    expect(screen.getByRole('dialog', { name: 'Rappel des pièces' })).toBeTruthy();
    expect(within(dialog()).getByLabelText<HTMLInputElement>('Rappel des pièces').value).toBe('30');
  });
});

describe('Réglages › Facturation, contrat et mandat', () => {
  it('lists each version with its fingerprint, the newest in force', async () => {
    texts = [MANDATE_V2, MANDATE_V1, CONTRACT_V1];
    renderSection();
    const card = await waitFor(() => cardOf('Mandat de facturation'));
    await within(card).findByText('Version 2');
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] ?? card).getByText('En vigueur')).toBeTruthy();
    expect(within(items[1] ?? card).queryByText('En vigueur')).toBeNull();
    expect(items[0]?.textContent).toContain(
      'Écrite le 29 octobre 2026 · empreinte 3333…3333 · contestation 7 jours',
    );
  });

  it('writes a new version as pasted, never trimmed, with the mandate’s delay and one key per text', async () => {
    renderSection();
    const card = await waitFor(() => cardOf('Mandat de facturation'));
    await within(card).findByText('Version 1');
    fireEvent.click(within(card).getByRole('button', { name: 'Nouvelle version : Mandat de facturation' }));
    expect(screen.getByRole('dialog', { name: 'Mandat de facturation, version 2' })).toBeTruthy();
    expect(within(dialog()).getByLabelText<HTMLInputElement>('Délai de contestation').value).toBe('7');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire cette version' }));
    expect(within(dialog()).getByText('Colle le texte validé par ton comptable.')).toBeTruthy();
    type('Délai de contestation', '61');
    type('Le texte', '  Mandat, version 2.\n');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire cette version' }));
    expect(within(dialog()).getByText('Un nombre entier de jours, de 1 à 60.')).toBeTruthy();
    expect(writes).toEqual([]);

    type('Délai de contestation', '10');
    answer = { status: 503, body: null };
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire cette version' }));
    await within(dialog()).findByRole('alert');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire cette version' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: '/v1/payroll/contract-texts',
      body: { kind: 'billing_mandate', body: '  Mandat, version 2.\n', contestDelayDays: 10 },
    });
    // A retry of the same text sends the same key.
    expect(writes[1]?.body).toEqual(writes[0]?.body);
  });
});

describe('Réglages › Facturation, régimes', () => {
  it('shows the regimes still to validate first, and notes a validation once, today at the latest', async () => {
    renderSection();
    const card = await waitFor(() => cardOf('Régimes de facturation'));
    await within(card).findByText('Prestataire Bénin, version 2');
    const items = within(card)
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('bf-regime'));
    expect(items.map((item) => item.querySelector('.bf-version__name')?.textContent)).toEqual([
      'Prestataire Bénin, version 2',
      'Prestataire Bénin et Madagascar',
      'Micro-entrepreneur France',
    ]);
    const draft = items[0] ?? card;
    expect(draft.dataset['pending']).toBe('true');
    expect(within(draft).getByText('À valider').className).toBe('rp-chip rp-chip--warn');
    expect(draft.textContent).toContain('Bénin, Madagascar');
    expect(draft.textContent).toContain('Autoliquidée par l’agence, 20');
    expect(draft.textContent).toContain('Écartée par la convention fiscale');
    expect(draft.textContent).toContain('Attestation de résidence fiscale');
    expect(within(items[1] ?? card).getByText('Validé')).toBeTruthy();
    expect(items[1]?.textContent).toContain('Par le comptable, le 30 octobre 2026');
    expect(within(items[1] ?? card).queryByRole('button', { name: 'Noter la validation' })).toBeNull();

    fireEvent.click(within(draft).getByRole('button', { name: 'Noter la validation' }));
    expect(within(dialog()).getByLabelText<HTMLInputElement>('Validé le').value).toBe('2026-11-05');
    type('Validé le', '2026-11-06');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Noter la validation' }));
    expect(within(dialog()).getByText('Au plus tard aujourd’hui, le 5 novembre 2026.')).toBeTruthy();
    type('Validé le', '2026-11-04');
    answer = {
      status: 409,
      body: {
        error: { code: 'billing_regime_validated_conflict', message: 'x', details: {}, requestId: 'r' },
      },
    };
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Noter la validation' }));
    expect((await within(dialog()).findByRole('alert')).textContent).toBe(
      'La validation du comptable est déjà notée, à un autre jour : elle ne se note qu’une fois.',
    );
    expect(writes).toEqual([
      {
        method: 'POST',
        path: `/v1/payroll/billing-regimes/${BENIN_DRAFT.id}/validation`,
        body: { validatedOn: '2026-11-04' },
      },
    ]);
  });

  it('writes a regime as the accountant wrote it, the treaty asking for the certificate', async () => {
    regimes = [];
    renderSection();
    const card = await waitFor(() => cardOf('Régimes de facturation'));
    expect(
      await within(card).findByText(
        'Aucun régime : sans régime validé, aucune facture ne part. Écris celui que ton comptable a rédigé.',
      ),
    ).toBeTruthy();
    expect(card.textContent).toContain(
      'Le texte d’un régime ne répète pas ce que le code imprime déjà : le badge « Autofacturation », le mandat, la catégorie de l’opération, la TVA et l’échéance.',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Nouveau régime : Régimes de facturation' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire ce régime' }));
    expect(within(dialog()).getByText('Au moins un pays.')).toBeTruthy();
    expect(writes).toEqual([]);

    type('Nom', 'Prestataire Bénin');
    fireEvent.change(within(dialog()).getByLabelText('Ajouter un pays'), { target: { value: 'BJ' } });
    fireEvent.change(within(dialog()).getByLabelText('Ajouter un pays'), { target: { value: 'MG' } });
    expect(within(dialog()).getByRole('list', { name: 'Pays du régime' }).textContent).toContain(
      'Madagascar',
    );

    // Without a treaty, the certificate asked only puts a warning on the invoices: said in amber, never refused.
    const certificate = within(dialog()).getByRole('checkbox', {
      name: /^Attestation de résidence fiscale/u,
    });
    fireEvent.click(certificate);
    expect(
      within(dialog()).getByText(
        'Sans convention, l’attestation de résidence fiscale ne bloque aucun versement : une facture part avec un avertissement tant qu’elle manque ou qu’elle est échue.',
      ).className,
    ).toBe('tm-hint cf-amber');
    fireEvent.click(certificate);
    // The treaty ticks the certificate and keeps it ticked.
    fireEvent.click(within(dialog()).getByRole('radio', { name: /^Écartée par la convention fiscale/u }));
    expect(certificate).toHaveProperty('checked', true);
    expect(certificate).toHaveProperty('disabled', true);
    expect(within(dialog()).queryByText(/^Sans convention/u)).toBeNull();

    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /^Identifiant fiscal exigé/u }));
    type('Taux', '20');
    type('Mention 1', 'Autoliquidation');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Ajouter une mention' }));
    type('Mention 2', '   ');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Écrire ce régime' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: '/v1/payroll/billing-regimes',
      body: {
        name: 'Prestataire Bénin',
        countries: ['BJ', 'MG'],
        vat: { treatment: 'reverse_charge', rateBps: 2000 },
        withholding: 'treaty_exempt',
        mentions: ['Autoliquidation'],
        documents: ['tax_residence'],
        taxIdRequired: true,
      },
    });
  });
});
