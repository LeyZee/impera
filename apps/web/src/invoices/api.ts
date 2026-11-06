import {
  ApiErrorSchema,
  INVOICE_ERROR_CODES,
  InvoiceAcceptanceViewSchema,
  InvoiceListSchema,
  type ContestInvoiceBody,
  type InvoiceAcceptanceView,
  type InvoiceErrorCode,
  type InvoiceList,
  type InvoiceListQuery,
  type RefuseInvoiceContestBody,
  type UpholdInvoiceContestBody,
} from '@impera/contracts';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import { olderYear, yearRange } from './model';

import { PAYROLL_KEY } from '@/payroll/api';

/**
 * `/v1/payroll/invoices` as the invoices' screens read and answer it (EQ-06 lot 8): the list with what the server
 * computed (`due`, the acceptance, the settlement), and the four answers to a document. Every answer is parsed with
 * the contract; the server decides who reads and answers what, the screens only say it.
 */

const BASE = '/v1/payroll/invoices';
const INVOICES_KEY = [...PAYROLL_KEY, 'invoices'] as const;

/** A list's query as the address writes it: each filter once, its values comma-separated. */
export type InvoiceListFilter = {
  readonly [K in keyof InvoiceListQuery]?: K extends 'due' | 'acceptance'
    ? readonly NonNullable<InvoiceListQuery[K]>[number][]
    : InvoiceListQuery[K];
};

export function invoiceListUrl(filter: InvoiceListFilter): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    params.set(name, Array.isArray(value) ? value.join(',') : String(value));
  }
  const query = params.toString();
  return query === '' ? BASE : `${BASE}?${query}`;
}

async function readList(url: string): Promise<InvoiceList> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return InvoiceListSchema.parse(await response.json());
}

/** The documents a filter keeps, as the reader may read them; `null` waits (a filter not known yet). */
export function useInvoices(filter: InvoiceListFilter | null): UseQueryResult<InvoiceList> {
  const url = filter === null ? null : invoiceListUrl(filter);
  return useQuery({
    queryKey: [...INVOICES_KEY, url],
    queryFn: () => {
      if (url === null) throw new Error('No filter');
      return readList(url);
    },
    enabled: url !== null,
    placeholderData: (before) => before,
    // An answer by a job (the tacit acceptance, a settlement) lands without a write here.
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 400,
  });
}

/**
 * One's documents a year at a time, the latest first: the year up to `today`, then each « Plus anciennes » the year
 * before, up to the ten years an invoice is kept. A year without a document does not end the list.
 */
export function useInvoiceYears(
  filter: Pick<InvoiceListFilter, 'memberId'>,
  today: string | null,
): UseInfiniteQueryResult<InfiniteData<InvoiceList, number>> {
  return useInfiniteQuery({
    queryKey: [...INVOICES_KEY, 'years', filter.memberId ?? null, today],
    queryFn: ({ pageParam }) => {
      if (today === null) throw new Error('No day');
      return readList(invoiceListUrl({ ...filter, ...yearRange(today, pageParam) }));
    },
    initialPageParam: 0,
    getNextPageParam: (_last, _pages, back) => olderYear(back),
    enabled: today !== null,
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 400,
  });
}

/** A document's acceptance and each dated step of its life (`issued` first), read when its detail opens. */
export function useInvoiceAcceptance(invoiceId: string | null): UseQueryResult<InvoiceAcceptanceView> {
  return useQuery({
    queryKey: [...INVOICES_KEY, 'acceptance', invoiceId],
    queryFn: async () => {
      if (invoiceId === null) throw new Error('No document');
      const url = `${BASE}/${invoiceId}/acceptance`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
      return InvoiceAcceptanceViewSchema.parse(await response.json());
    },
    enabled: invoiceId !== null,
    retry: 1,
    retryDelay: 400,
  });
}

/** Besides the invoices' own: an end of a contest by anyone but the owner, a role guard, a body let through. */
export type InvoiceRefusalCode =
  InvoiceErrorCode | 'payroll_forbidden' | 'role_forbidden' | 'request_invalid' | 'team_member_not_found';

const DetailsSchema = z.object({ reason: z.string() }).partial();

/** A refusal the screen words, or a server that does not answer. */
export type InvoiceRefusal =
  | {
      readonly kind: 'refused';
      readonly code: InvoiceRefusalCode;
      readonly details: z.infer<typeof DetailsSchema>;
    }
  | { readonly kind: 'failed' };

export type InvoiceOutcome<T> = { readonly kind: 'ok'; readonly value: T } | InvoiceRefusal;

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...INVOICE_ERROR_CODES,
  'payroll_forbidden',
  'role_forbidden',
  'request_invalid',
  'team_member_not_found',
]);
const isKnown = (code: string): code is InvoiceRefusalCode => KNOWN.has(code);

async function refusalOf(response: Response): Promise<InvoiceRefusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !isKnown(parsed.data.error.code)) return { kind: 'failed' };
  const details = DetailsSchema.safeParse(parsed.data.error.details);
  return { kind: 'refused', code: parsed.data.error.code, details: details.success ? details.data : {} };
}

/**
 * A document's PDF as its bytes, read before it is saved: a PDF the server cannot give says why on the screen, never
 * saved as a file holding its error (recette EQP-08). An answer that is not a PDF is `failed`.
 */
export async function readInvoicePdf(invoiceId: string): Promise<InvoiceOutcome<Blob>> {
  try {
    const response = await fetch(`${BASE}/${invoiceId}/pdf`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return await refusalOf(response);
    if (!(response.headers.get('content-type') ?? '').startsWith('application/pdf'))
      return { kind: 'failed' };
    return { kind: 'ok', value: new Blob([await response.arrayBuffer()], { type: 'application/pdf' }) };
  } catch {
    return { kind: 'failed' };
  }
}

/** What a write sends: a JSON body, or a file's bytes as they are. */
export type WriteBody = { readonly json: unknown } | { readonly bytes: Blob };

/**
 * A write to the payroll API (the invoices, the contractor's file): its answer parsed with the contract, or its refusal
 * by code; a server that does not answer, or answers what the contract does not know, is `failed`.
 */
export async function write<T>(
  url: string,
  method: 'POST' | 'PUT',
  body: WriteBody,
  schema: z.ZodType<T>,
): Promise<InvoiceOutcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'json' in body ? 'application/json' : 'application/octet-stream' },
      body: 'json' in body ? JSON.stringify(body.json) : body.bytes,
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: schema.parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

const answer = (
  invoiceId: string,
  path: string,
  body: unknown,
): Promise<InvoiceOutcome<InvoiceAcceptanceView>> =>
  write(`${BASE}/${invoiceId}/${path}`, 'POST', { json: body }, InvoiceAcceptanceViewSchema);

/** « J'accepte » : the contractor alone; the same answer sent again gives the view back. */
export const acceptInvoice = (invoiceId: string): Promise<InvoiceOutcome<InvoiceAcceptanceView>> =>
  answer(invoiceId, 'accept', {});

/** « Je conteste », with its reason: the contractor alone; the owner is told. */
export const contestInvoice = (
  invoiceId: string,
  body: ContestInvoiceBody,
): Promise<InvoiceOutcome<InvoiceAcceptanceView>> => answer(invoiceId, 'contest', body);

/** The owner refuses a contest, with the reason the contractor reads. */
export const refuseContest = (
  invoiceId: string,
  body: RefuseInvoiceContestBody,
): Promise<InvoiceOutcome<InvoiceAcceptanceView>> => answer(invoiceId, 'contest/refuse', body);

/** The owner upholds a contest: its reason and its one correction, written by pay in the same action. */
export const upholdContest = (
  invoiceId: string,
  body: UpholdInvoiceContestBody,
): Promise<InvoiceOutcome<InvoiceAcceptanceView>> => answer(invoiceId, 'contest/uphold', body);

/**
 * After an answer: every list reads again, and pay too, since an upheld contest writes adjustments into the member's
 * next open period.
 */
export function useRefreshInvoices(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: PAYROLL_KEY }), [client]);
}
