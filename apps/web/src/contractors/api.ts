import {
  BillingRegimesSchema,
  ContractAcceptanceSchema,
  ContractorDocumentSchema,
  ContractorFileSchema,
  ContractorProfileSchema,
  ContractorRegimeSchema,
  ContractTextsSchema,
  PendingContractorDocumentsSchema,
  type AssignContractorRegimeBody,
  type BillingRegimes,
  type ContractAcceptance,
  type ContractorDocument,
  type ContractorDocumentReview,
  type ContractorFile,
  type ContractorProfile,
  type ContractorProfileBody,
  type ContractorRegime,
  type ContractTexts,
  type PendingContractorDocuments,
  type UploadContractorDocumentQuery,
} from '@impera/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { write, type InvoiceOutcome } from '@/invoices/api';
import { PAYROLL_KEY } from '@/payroll/api';

/**
 * The contractor's file as Moi › Dossier and the owner's Équipe › Membres › Dossier read and write it (EQ-06 lot 8b):
 * his identity, the texts he accepted, his regimes and his documents, as `GET …/file` gives them. Every answer is
 * parsed with the contract; the server decides who writes what, the screens only say it.
 */

const BASE = '/v1/payroll/contractors';
const FILE_KEY = [...PAYROLL_KEY, 'contractor-file'] as const;

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

/** A member's file; `null` waits (a member not known yet). Read again each minute: the owner's checks land there. */
export function useContractorFile(memberId: string | null): UseQueryResult<ContractorFile> {
  return useQuery({
    queryKey: [...FILE_KEY, memberId],
    queryFn: () => {
      if (memberId === null) throw new Error('No member');
      return read(`${BASE}/${memberId}/file`, (body) => ContractorFileSchema.parse(body));
    },
    enabled: memberId !== null,
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 400,
  });
}

/**
 * The documents waiting for the owner's check, the oldest first (EQ-06 complement 5), his own left out by the server;
 * read only when `enabled` (the owner's Dashboard), again each minute.
 */
export function usePendingDocuments(enabled: boolean): UseQueryResult<PendingContractorDocuments> {
  return useQuery({
    queryKey: [...FILE_KEY, 'pending'],
    queryFn: () =>
      read(`${BASE}/documents?review=pending`, (body) => PendingContractorDocumentsSchema.parse(body)),
    enabled,
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 400,
  });
}

/** Every version of the contract and of the mandate, the newest first: any member reads them. */
export function useContractTexts(): UseQueryResult<ContractTexts> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'contract-texts'],
    queryFn: () => read('/v1/payroll/contract-texts', (body) => ContractTextsSchema.parse(body)),
    retry: 1,
    retryDelay: 400,
  });
}

/** Every billing regime, the newest first, with the day the accountant validated it: any member reads them. */
export function useBillingRegimes(): UseQueryResult<BillingRegimes> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'billing-regimes'],
    queryFn: () => read('/v1/payroll/billing-regimes', (body) => BillingRegimesSchema.parse(body)),
    retry: 1,
    retryDelay: 400,
  });
}

/** Where a document's file downloads: the server serves it only when its fingerprint is the one kept. */
export const documentFileUrl = (memberId: string, documentId: string): string =>
  `${BASE}/${memberId}/documents/${documentId}/file`;

/** The contractor himself or the owner writes the file; any change of identity clears the owner's check. */
export const saveProfile = (
  memberId: string,
  body: ContractorProfileBody,
): Promise<InvoiceOutcome<ContractorProfile>> =>
  write(`${BASE}/${memberId}/profile`, 'PUT', { json: body }, ContractorProfileSchema);

/** The owner checked the file as he read it, at its `updatedAt`: one changed since is refused, never checked unseen. */
export const verifyProfile = (
  memberId: string,
  updatedAt: string,
): Promise<InvoiceOutcome<ContractorProfile>> =>
  write(`${BASE}/${memberId}/profile/verify`, 'POST', { json: { updatedAt } }, ContractorProfileSchema);

/** The owner sets the contractor's prefix, his alone, frozen by his first invoice. */
export const setPrefix = (
  memberId: string,
  invoicePrefix: string,
): Promise<InvoiceOutcome<ContractorProfile>> =>
  write(`${BASE}/${memberId}/profile/prefix`, 'PUT', { json: { invoicePrefix } }, ContractorProfileSchema);

/** The owner gives the contractor a regime of his country from a day on, today at the earliest. */
export const assignRegime = (
  memberId: string,
  body: AssignContractorRegimeBody,
): Promise<InvoiceOutcome<ContractorRegime>> =>
  write(`${BASE}/${memberId}/regimes`, 'POST', { json: body }, ContractorRegimeSchema);

/** The contractor accepts the version he read: its fingerprint goes with it, a text changed since is refused. */
export const acceptText = (textId: string, sha256: string): Promise<InvoiceOutcome<ContractAcceptance>> =>
  write(
    `/v1/payroll/contract-texts/${textId}/accept`,
    'POST',
    { json: { sha256 } },
    ContractAcceptanceSchema,
  );

/**
 * A document's file, sent as its bytes, with its kind and dates in the address. `id` is the key that makes a retry of
 * the same file safe: drawn once per file chosen, never per click.
 */
export function uploadDocument(
  memberId: string,
  query: UploadContractorDocumentQuery,
  file: Blob,
): Promise<InvoiceOutcome<ContractorDocument>> {
  const params = new URLSearchParams({ id: query.id, kind: query.kind, issuedOn: query.issuedOn });
  if (query.validUntil !== undefined) params.set('validUntil', query.validUntil);
  return write(
    `${BASE}/${memberId}/documents?${params.toString()}`,
    'POST',
    { bytes: file },
    ContractorDocumentSchema,
  );
}

/** The owner's check of a document, once: accepted, or refused with the reason the contractor reads. */
export const reviewDocument = (
  memberId: string,
  documentId: string,
  review: ContractorDocumentReview,
): Promise<InvoiceOutcome<ContractorDocument>> =>
  write(
    `${BASE}/${memberId}/documents/${documentId}/review`,
    'POST',
    { json: review },
    ContractorDocumentSchema,
  );

/** After a write: the file reads again, and pay too, since a check may let a waiting invoice leave. */
export function useRefreshFile(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: PAYROLL_KEY }), [client]);
}
