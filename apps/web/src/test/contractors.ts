import {
  BillingRegimeSchema,
  ContractAcceptanceSchema,
  ContractorFileDocumentSchema,
  ContractorFileSchema,
  ContractorProfileSchema,
  ContractorRegimeSchema,
  ContractTextSchema,
  type BillingRegime,
  type ContractAcceptance,
  type ContractorFile,
  type ContractorFileDocument,
  type ContractorProfile,
  type ContractorRegime,
  type ContractText,
  type TeamMember,
} from '@impera/contracts';
import { vi } from 'vitest';

import { MEMBERS, payId, SCHEDULING_SETTINGS, THEO } from './pay';

/*
 * The contractor's file's fakes (EQ-06 lot 8b), on the invented team of `pay.ts` (ADR 0010): Théo, of Benin, files his
 * tax residence certificate under the regime of Benin and Madagascar. Each fake is parsed with its contract.
 */

const SHA = 'a'.repeat(64);

export const BENIN_REGIME: BillingRegime = BillingRegimeSchema.parse({
  id: payId(600),
  name: 'Prestataire Bénin et Madagascar',
  countries: ['BJ', 'MG'],
  vat: { treatment: 'reverse_charge', rateBps: 2000 },
  withholding: 'treaty_exempt',
  mentions: ['Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: true,
  validatedOn: '2026-10-30',
  createdAt: '2026-10-30T08:00:00.000Z',
});

/** A newer regime for the same countries, which the accountant has not validated yet. */
export const BENIN_DRAFT: BillingRegime = BillingRegimeSchema.parse({
  ...BENIN_REGIME,
  id: payId(601),
  name: 'Prestataire Bénin, version 2',
  validatedOn: null,
  createdAt: '2026-11-03T08:00:00.000Z',
});

export const FRANCE_REGIME: BillingRegime = BillingRegimeSchema.parse({
  ...BENIN_REGIME,
  id: payId(602),
  name: 'Micro-entrepreneur France',
  countries: ['FR'],
  vat: { treatment: 'exempt' },
  withholding: 'none',
  mentions: ['TVA non applicable, art. 293 B du CGI'],
  documents: ['urssaf_vigilance'],
  taxIdRequired: false,
});

export const contractorRegimeOf = (
  n: number,
  regime: BillingRegime,
  from: string,
  whose: TeamMember = THEO,
): ContractorRegime =>
  ContractorRegimeSchema.parse({
    id: payId(610 + n),
    memberId: whose.id,
    regimeId: regime.id,
    from,
    createdAt: '2026-10-31T08:00:00.000Z',
  });

export const textOf = (n: number, kind: ContractText['kind'], version: number): ContractText =>
  ContractTextSchema.parse({
    id: payId(620 + n),
    kind,
    version,
    body: `Texte d’exemple, version ${String(version)}.\n\nArticle 1. Les parties conviennent de ce qui suit.`,
    sha256: String(n).repeat(64).slice(0, 64),
    contestDelayDays: kind === 'billing_mandate' ? 7 : null,
    createdAt: '2026-10-29T08:00:00.000Z',
  });

export const CONTRACT_V1 = textOf(1, 'service_contract', 1);
export const MANDATE_V1 = textOf(2, 'billing_mandate', 1);
export const MANDATE_V2 = textOf(3, 'billing_mandate', 2);

export const acceptanceOf = (n: number, text: ContractText, at: string): ContractAcceptance =>
  ContractAcceptanceSchema.parse({
    id: payId(630 + n),
    memberId: THEO.id,
    textId: text.id,
    sha256: text.sha256,
    acceptedAt: at,
  });

export function profileOf(patch: Partial<Record<keyof ContractorProfile, unknown>> = {}): ContractorProfile {
  return ContractorProfileSchema.parse({
    memberId: THEO.id,
    legalName: 'Théo Exemple',
    address: 'Rue 12, quartier Exemple\nCotonou',
    taxId: '0000000000000',
    businessId: null,
    vatNumber: null,
    individualEntrepreneur: false,
    legalForm: null,
    shareCapitalMinor: null,
    rcsCity: null,
    email: 'membre1@example.test',
    invoicePrefix: 'THEO',
    verifiedAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T08:30:00.000Z',
    ...patch,
  });
}

export function documentOf(
  n: number,
  patch: Partial<Record<keyof ContractorFileDocument, unknown>> = {},
): ContractorFileDocument {
  return ContractorFileDocumentSchema.parse({
    id: payId(640 + n),
    memberId: THEO.id,
    kind: 'tax_residence',
    issuedOn: '2026-02-10',
    validUntil: null,
    lastDay: '2026-12-31',
    mediaType: 'application/pdf',
    sha256: SHA,
    review: { decision: 'accepted', reviewedAt: '2026-02-12T09:00:00.000Z' },
    purgedAt: null,
    createdAt: '2026-02-11T09:00:00.000Z',
    remindFrom: '2026-12-01',
    ...patch,
  });
}

export function fileOf(patch: Partial<Record<keyof ContractorFile, unknown>> = {}): ContractorFile {
  return ContractorFileSchema.parse({
    memberId: THEO.id,
    today: '2026-11-05',
    country: 'BJ',
    profile: profileOf(),
    prefixFrozen: false,
    acceptances: [],
    regimes: [contractorRegimeOf(1, BENIN_REGIME, '2026-11-01')],
    documents: [],
    ...patch,
  });
}

/** A write the screen sent: its method, its address, and its JSON body or the weight of its bytes. */
export interface FileWrite {
  readonly method: string;
  readonly path: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
}

/** What the fake server holds: the file it answers, and a refusal for the next write, if any. */
export interface FileServer {
  file: ContractorFile;
  texts: ContractText[];
  regimes: BillingRegime[];
  members: TeamMember[];
  refusal: { readonly status: number; readonly code: string } | null;
  readonly writes: FileWrite[];
}

export function fileServer(): FileServer {
  return {
    file: fileOf(),
    texts: [MANDATE_V1, CONTRACT_V1],
    regimes: [BENIN_DRAFT, BENIN_REGIME, FRANCE_REGIME],
    members: MEMBERS,
    refusal: null,
    writes: [],
  };
}

/** The answer of a write, as the contract of its route gives it. */
function answerOf(path: string, server: FileServer): unknown {
  if (path.endsWith('/accept')) return acceptanceOf(9, CONTRACT_V1, '2026-11-05T09:00:00.000Z');
  if (path.endsWith('/regimes')) return contractorRegimeOf(9, BENIN_REGIME, server.file.today);
  if (path.includes('/documents')) return documentOf(9, { review: null });
  return server.file.profile ?? profileOf();
}

/** Stubs `fetch` with the server's state, read at each call: a test changes the file, the next read sees it. */
export function serveFile(server: FileServer): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body = init?.body;
        server.writes.push({
          method,
          path: url.pathname,
          search: url.searchParams,
          body:
            typeof body === 'string' ? JSON.parse(body) : body instanceof Blob ? { bytes: body.size } : null,
        });
        const refusal = server.refusal;
        server.refusal = null;
        if (refusal !== null)
          return json(
            { error: { code: refusal.code, message: 'Refusé', details: {}, requestId: 'test' } },
            refusal.status,
          );
        return json(answerOf(url.pathname, server));
      }
      if (url.pathname === `/v1/payroll/contractors/${server.file.memberId}/file`) return json(server.file);
      switch (url.pathname) {
        case '/v1/payroll/contract-texts':
          return json({ texts: server.texts });
        case '/v1/payroll/billing-regimes':
          return json({ regimes: server.regimes });
        case '/v1/team/members':
          return json({ members: server.members });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}
