import {
  ApiErrorSchema,
  BonusSchema,
  BonusTierSetSchema,
  CollectiveGoalSchema,
  CommissionStatementSchema,
  ExchangeRatesSchema,
  PayAdjustmentSchema,
  PayPeriodPageSchema,
  PAYROLL_ERROR_CODES,
  PayrollEntriesSchema,
  PayrollPeriodSchema,
  PayrollSettingsSchema,
  PayoutMinimumSchema,
  PenaltySchema,
  type Bonus,
  type BonusTierSet,
  type CollectiveGoal,
  type CommissionStatement,
  type CreateBonusBody,
  type CreateBonusTierSetBody,
  type CreateCollectiveGoalBody,
  type CreatePayAdjustmentBody,
  type CreatePayoutMinimumBody,
  type CreatePenaltyBody,
  type ExchangeRates,
  type PayAdjustment,
  type PayCommissionStatementBody,
  type PayPeriod,
  type PayPeriodPage,
  type PayrollEntries,
  type PayrollErrorCode,
  type PayrollPeriod,
  type PayrollSettings,
  type PayoutMinimum,
  type Penalty,
  type UpdatePayrollSettingsBody,
} from '@nirvana/contracts';
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

/**
 * `/v1/payroll` as Paie and Commissions read and write it (EQ-05). Every answer is parsed with the contract; the server
 * decides who reads and writes what (`withMember`), the screens only say it.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

/** A page cursor the list of periods did not give (`cursor_invalid`): the list reads again from its start. */
export class PeriodCursorInvalid extends Error {}

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    if (response.status === 400 && (await codeOf(response)) === 'cursor_invalid')
      throw new PeriodCursorInvalid(url);
    throw new Error(`GET ${url}: ${String(response.status)}`);
  }
  return parse(await response.json());
}

const codeOf = async (response: Response): Promise<string | null> => {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
};

export const PAYROLL_KEY = ['payroll'] as const;

/**
 * A read of pay tries once more, not three times: a server that does not answer is said within a second or two, never
 * behind a skeleton that looks like loading.
 */
const READ_RETRY = 1;
const READ_RETRY_DELAY_MS = 400;
const periodKey = (period: PayPeriod) => [...PAYROLL_KEY, 'period', period] as const;

const readPeriod = (period: PayPeriod): Promise<PayrollPeriod> =>
  read(`/v1/payroll/periods/${period}`, (body) => PayrollPeriodSchema.parse(body));

/** A period as its reader may see it: its statements, closing, tiers, goal and minimum. */
export function usePayPeriod(period: PayPeriod | null): UseQueryResult<PayrollPeriod> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'period', period],
    queryFn: () => (period === null ? Promise.reject(new Error('No period')) : readPeriod(period)),
    enabled: period !== null,
    // A recalculation lands without a write here (a report validated, the hourly run): read again every minute.
    refetchInterval: 60_000,
    placeholderData: (before) => before,
    retry: READ_RETRY,
    retryDelay: READ_RETRY_DELAY_MS,
  });
}

/** Several periods at once, from the same cache as `usePayPeriod`: those that say where a member's next entry goes. */
export function usePayPeriodReads(
  periods: readonly PayPeriod[],
): (period: PayPeriod) => PayrollPeriod | undefined {
  const reads = useQueries({
    queries: periods.map((period) => ({
      queryKey: periodKey(period),
      queryFn: () => readPeriod(period),
      refetchInterval: 60_000,
      retry: READ_RETRY,
      retryDelay: READ_RETRY_DELAY_MS,
    })),
  });
  return (period) => reads[periods.indexOf(period)]?.data;
}

/** The first page of a list: no cursor. */
const FIRST_PAGE: string | null = null;

/** The periods the reader has statements in, the most recent first, a page at a time. */
export function usePayPeriods(): UseInfiniteQueryResult<InfiniteData<PayPeriodPage>> {
  return useInfiniteQuery({
    queryKey: [...PAYROLL_KEY, 'periods'],
    queryFn: ({ pageParam }) =>
      read(pageParam === null ? '/v1/payroll/periods' : `/v1/payroll/periods?cursor=${pageParam}`, (body) =>
        PayPeriodPageSchema.parse(body),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.nextCursor,
    retry: (count, error) => !(error instanceof PeriodCursorInvalid) && count < READ_RETRY,
    retryDelay: READ_RETRY_DELAY_MS,
  });
}

/** A period's bonuses, penalties and adjustments, cancelled ones included. */
export function usePayEntries(period: PayPeriod | null): UseQueryResult<PayrollEntries> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'entries', period],
    queryFn: () =>
      read(`/v1/payroll/entries?period=${period ?? ''}`, (body) => PayrollEntriesSchema.parse(body)),
    enabled: period !== null,
    placeholderData: (before) => before,
    retry: READ_RETRY,
    retryDelay: READ_RETRY_DELAY_MS,
  });
}

export function usePayrollSettings(): UseQueryResult<PayrollSettings> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'settings'],
    queryFn: () => read('/v1/payroll/settings', (body) => PayrollSettingsSchema.parse(body)),
    staleTime: 5 * 60_000,
    retry: READ_RETRY,
    retryDelay: READ_RETRY_DELAY_MS,
  });
}

/** The latest rate the job read: the agency's, for the notice of a missing rate. */
export function useExchangeRates(enabled: boolean): UseQueryResult<ExchangeRates> {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'exchange-rates'],
    queryFn: () => read('/v1/payroll/exchange-rates', (body) => ExchangeRatesSchema.parse(body)),
    enabled,
    staleTime: 10 * 60_000,
    retry: READ_RETRY,
    retryDelay: READ_RETRY_DELAY_MS,
  });
}

/** Besides pay's own: a role guard, and a body the server refuses that the screen let through. */
export type PayRefusalCode = PayrollErrorCode | 'role_forbidden' | 'request_invalid';

/** What some refusals say more: a count of reports, a period, a member, an amount, a day. */
const DetailsSchema = z
  .object({
    count: z.number().int(),
    period: z.string(),
    memberId: z.string(),
    statementId: z.string(),
    payableMinor: z.number().int(),
    today: z.string(),
    currency: z.string(),
  })
  .partial();
export type PayRefusalDetails = z.infer<typeof DetailsSchema>;

/** A refusal the screen words, or a server that does not answer. */
export type PayRefusal =
  | { readonly kind: 'refused'; readonly code: PayRefusalCode; readonly details: PayRefusalDetails }
  | { readonly kind: 'failed' };

export type PayOutcome<T> = { readonly kind: 'ok'; readonly value: T } | PayRefusal;

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...PAYROLL_ERROR_CODES,
  'role_forbidden',
  'request_invalid',
]);
const isKnown = (code: string): code is PayRefusalCode => KNOWN.has(code);

async function refusalOf(response: Response): Promise<PayRefusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !isKnown(parsed.data.error.code)) return { kind: 'failed' };
  const details = DetailsSchema.safeParse(parsed.data.error.details);
  return { kind: 'refused', code: parsed.data.error.code, details: details.success ? details.data : {} };
}

async function send<T>(
  method: 'POST' | 'PUT',
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
): Promise<PayOutcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: JSON_HEADERS,
      // A held validation is sent as the page goes away too (Hold.tsx): the request outlives it.
      keepalive: true,
      body: JSON.stringify(body),
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

const statement = (json: unknown): CommissionStatement => CommissionStatementSchema.parse(json);

/** A statement validated on the revision the reader saw; the first of a period closes it for the team. */
export const validateStatement = (id: string, revision: number): Promise<PayOutcome<CommissionStatement>> =>
  send('POST', `/v1/payroll/statements/${id}/validate`, { revision }, statement);

/** A validated statement marked paid (owner): the day, the method, the reference, the amount sent. */
export const payStatement = (
  id: string,
  body: PayCommissionStatementBody,
): Promise<PayOutcome<CommissionStatement>> =>
  send('POST', `/v1/payroll/statements/${id}/pay`, body, statement);

export const addBonus = (body: CreateBonusBody): Promise<PayOutcome<Bonus>> =>
  send('POST', '/v1/payroll/bonuses', body, (json) => BonusSchema.parse(json));

export const cancelBonus = (id: string): Promise<PayOutcome<Bonus>> =>
  send('POST', `/v1/payroll/bonuses/${id}/cancel`, {}, (json) => BonusSchema.parse(json));

export const addPenalty = (body: CreatePenaltyBody): Promise<PayOutcome<Penalty>> =>
  send('POST', '/v1/payroll/penalties', body, (json) => PenaltySchema.parse(json));

export const cancelPenalty = (id: string): Promise<PayOutcome<Penalty>> =>
  send('POST', `/v1/payroll/penalties/${id}/cancel`, {}, (json) => PenaltySchema.parse(json));

export const addAdjustment = (body: CreatePayAdjustmentBody): Promise<PayOutcome<PayAdjustment>> =>
  send('POST', '/v1/payroll/adjustments', body, (json) => PayAdjustmentSchema.parse(json));

export const addBonusTiers = (body: CreateBonusTierSetBody): Promise<PayOutcome<BonusTierSet>> =>
  send('POST', '/v1/payroll/bonus-tiers', body, (json) => BonusTierSetSchema.parse(json));

export const addCollectiveGoal = (body: CreateCollectiveGoalBody): Promise<PayOutcome<CollectiveGoal>> =>
  send('POST', '/v1/payroll/collective-goals', body, (json) => CollectiveGoalSchema.parse(json));

/** PAIE-32: the payout delay announced to the team, `null` for none. */
export const setPayrollSettings = (body: UpdatePayrollSettingsBody): Promise<PayOutcome<PayrollSettings>> =>
  send('PUT', '/v1/payroll/settings', body, (json) => PayrollSettingsSchema.parse(json));

/** PAIE-22: a payout minimum from a period that has not begun; the same `id` sent twice is one. */
export const addPayoutMinimum = (body: CreatePayoutMinimumBody): Promise<PayOutcome<PayoutMinimum>> =>
  send('POST', '/v1/payroll/payout-minimums', body, (json) => PayoutMinimumSchema.parse(json));

/** After a write, and after a refusal that says the period changed: everything pay shows reads again. */
export function useRefreshPayroll(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: PAYROLL_KEY }), [client]);
}

/** One period read again, after a refusal that says its statement changed. */
export function useRefreshPayPeriod(): (period: PayPeriod) => Promise<void> {
  const client = useQueryClient();
  return useCallback((period) => client.invalidateQueries({ queryKey: periodKey(period) }), [client]);
}

/**
 * A period as the server has it now, to judge a refusal by: from the cache when `useRefreshPayroll` just read it again,
 * read otherwise (an invalidated or missing period always is); `null` when the server does not answer.
 */
export function useLatestPayPeriod(): (period: PayPeriod) => Promise<PayrollPeriod | null> {
  const client = useQueryClient();
  return useCallback(
    (period) =>
      client
        .query({ queryKey: periodKey(period), queryFn: () => readPeriod(period), staleTime: Infinity })
        .catch(() => null),
    [client],
  );
}
