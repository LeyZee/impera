import {
  AccountPayRulesListSchema,
  AccountPayRulesSchema,
  ApiErrorSchema,
  PAY_RULES_ERROR_CODES,
  SchedulingSettingsSchema,
  SHIFT_REPORT_BATCH_MAX,
  SHIFT_REPORT_ERROR_CODES,
  ShiftReportContextSchema,
  ShiftReportListSchema,
  ShiftReportSchema,
  ValidateShiftReportsResultSchema,
  type AccountPayRules,
  type AccountPayRulesList,
  type CreateAccountPayRulesBody,
  type CreateShiftReportBody,
  type PayPeriod,
  type PayRulesErrorCode,
  type RejectShiftReportBody,
  type SchedulingSettings,
  type ShiftReport,
  type ShiftReportContext,
  type ShiftReportErrorCode,
  type ShiftReportList,
  type UpdateShiftReportBody,
  type ValidateShiftReportsBody,
  type ValidateShiftReportsResult,
} from '@nirvana/contracts';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import { mergeLists } from './model';

import { SCHEDULING_KEY } from '@/scheduling/api';

/**
 * The end-of-shift reports and the accounts' pay rules as the screens read them (EQ-03): `/v1/scheduling/…` for the
 * reports, `/v1/team/pay-rules` for the rules. Every answer is parsed with the contract.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

/** Under the planning's key: a report written reads the planning again, and the reverse. */
const REPORTS_KEY = [...SCHEDULING_KEY, 'reports'] as const;
const PAY_RULES_KEY = ['team', 'pay-rules'] as const;

/** The grid's settings, for the agency's zone the periods follow. */
export function useSchedulingSettings(): UseQueryResult<SchedulingSettings> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'settings'],
    queryFn: () => read('/v1/scheduling/settings', (body) => SchedulingSettingsSchema.parse(body)),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** What the report panel of one shift needs: the shift, its account, period and rules, and its reports. */
export function useReportContext(shiftId: string): UseQueryResult<ShiftReportContext> {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'context', shiftId],
    queryFn: () =>
      read(`/v1/scheduling/shifts/${shiftId}/report`, (body) => ShiftReportContextSchema.parse(body)),
  });
}

/** A period's reports and the shifts that take one; without a period, what is still open. */
const listQuery = (period: PayPeriod | null) => ({
  queryKey: [...REPORTS_KEY, 'list', period],
  queryFn: () =>
    read(
      period === null ? '/v1/scheduling/shift-reports' : `/v1/scheduling/shift-reports?period=${period}`,
      (body) => ShiftReportListSchema.parse(body),
    ),
  // A colleague's validation lands without a write here: read again every minute, like the swaps.
  refetchInterval: 60_000,
});

export function useReports(period: PayPeriod | null, enabled = true): UseQueryResult<ShiftReportList> {
  // One retry: a silent server is said in about a second (EQ-22).
  return useQuery({ ...listQuery(period), enabled, retry: 1, placeholderData: (before) => before });
}

/** The reports of some periods as one read: a planning week spans one or two. */
export interface ReportsOf {
  /** Their lists as one, `null` until each is read. */
  readonly list: ShiftReportList | null;
  /** A period's read failed: the screen says so rather than show no report to make. */
  readonly failed: boolean;
  readonly retry: () => void;
}

export function useReportsOf(periods: readonly PayPeriod[]): ReportsOf {
  // One retry, as `useReports`: a silent server is said in about a second (EQ-22).
  return useQueries({
    queries: periods.map((period) => ({ ...listQuery(period), retry: 1 })),
    combine: listsAsOne,
  });
}

/** The periods' lists as one once each is read. Out of the hook, so that TanStack keeps it while they do not change. */
function listsAsOne(results: UseQueryResult<ShiftReportList>[]): ReportsOf {
  const lists = results.flatMap((result) => (result.data === undefined ? [] : [result.data]));
  return {
    list: lists.length === 0 || lists.length < results.length ? null : mergeLists(lists),
    failed: results.some((result) => result.isError),
    retry: () => {
      for (const result of results) if (result.isError) void result.refetch();
    },
  };
}

/** The owner's and the managers' read of the accounts' rules, with the period running now. */
export function usePayRules(enabled = true): UseQueryResult<AccountPayRulesList> {
  return useQuery({
    queryKey: PAY_RULES_KEY,
    queryFn: () => read('/v1/team/pay-rules', (body) => AccountPayRulesListSchema.parse(body)),
    enabled,
    retry: false,
  });
}

/** Besides the reports' and the rules' own: a role guard, and a body the server refuses that the screen let through. */
export type ReportRefusalCode =
  ShiftReportErrorCode | PayRulesErrorCode | 'role_forbidden' | 'request_invalid';

/** A refusal the screen words, or a server that does not answer. */
export type ReportRefusal =
  | {
      readonly kind: 'refused';
      readonly code: ReportRefusalCode;
      /** The shift's report already made (`shift_report_exists_conflict`). */
      readonly shiftReportId: string | null;
      /** When the shift takes its report (`shift_report_early_conflict`). */
      readonly opensAt: string | null;
    }
  | { readonly kind: 'failed' };

export type ReportOutcome<T> = { readonly kind: 'ok'; readonly value: T } | ReportRefusal;

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...SHIFT_REPORT_ERROR_CODES,
  ...PAY_RULES_ERROR_CODES,
  'role_forbidden',
  'request_invalid',
]);
const isKnown = (code: string): code is ReportRefusalCode => KNOWN.has(code);

const DetailsSchema = z.object({ shiftReportId: z.string().optional(), opensAt: z.string().optional() });

async function refusalOf(response: Response): Promise<ReportRefusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || !isKnown(parsed.data.error.code)) return { kind: 'failed' };
  const details = DetailsSchema.safeParse(parsed.data.error.details);
  return {
    kind: 'refused',
    code: parsed.data.error.code,
    shiftReportId: details.success ? (details.data.shiftReportId ?? null) : null,
    opensAt: details.success ? (details.data.opensAt ?? null) : null,
  };
}

async function send<T>(
  method: 'POST' | 'PATCH',
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
): Promise<ReportOutcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: JSON_HEADERS,
      // A held report is sent as the page goes away too (Hold.tsx): the request outlives it.
      keepalive: true,
      body: JSON.stringify(body),
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

/** A report or a correction; a retry with the same `id` answers the one recorded. */
export const makeReport = (body: CreateShiftReportBody): Promise<ReportOutcome<ShiftReport>> =>
  send('POST', '/v1/scheduling/shift-reports', body, (json) => ShiftReportSchema.parse(json));

export const changeReport = (
  shiftReportId: string,
  body: UpdateShiftReportBody,
): Promise<ReportOutcome<ShiftReport>> =>
  send('PATCH', `/v1/scheduling/shift-reports/${shiftReportId}`, body, (json) =>
    ShiftReportSchema.parse(json),
  );

export const validateReports = (
  body: ValidateShiftReportsBody,
): Promise<ReportOutcome<ValidateShiftReportsResult['results']>> =>
  send(
    'POST',
    '/v1/scheduling/shift-reports/validate',
    body,
    (json) => ValidateShiftReportsResultSchema.parse(json).results,
  );

/**
 * A validation of any size, in the contract's batches of `SHIFT_REPORT_BATCH_MAX` sent one after the other: each
 * report's answer, and what stopped the batches still to send (the server, or a refusal of the whole batch).
 */
export async function validateInBatches(reports: ValidateShiftReportsBody['reports']): Promise<{
  readonly results: ValidateShiftReportsResult['results'];
  readonly stopped: ReportRefusal | null;
}> {
  const results: ValidateShiftReportsResult['results'] = [];
  for (let from = 0; from < reports.length; from += SHIFT_REPORT_BATCH_MAX) {
    const outcome = await validateReports({ reports: reports.slice(from, from + SHIFT_REPORT_BATCH_MAX) });
    if (outcome.kind !== 'ok') return { results, stopped: outcome };
    results.push(...outcome.value);
  }
  return { results, stopped: null };
}

export const rejectReport = (
  shiftReportId: string,
  body: RejectShiftReportBody,
): Promise<ReportOutcome<ShiftReport>> =>
  send('POST', `/v1/scheduling/shift-reports/${shiftReportId}/reject`, body, (json) =>
    ShiftReportSchema.parse(json),
  );

export const addPayRules = (body: CreateAccountPayRulesBody): Promise<ReportOutcome<AccountPayRules>> =>
  send('POST', '/v1/team/pay-rules', body, (json) => AccountPayRulesSchema.parse(json));

/** After a write, and after a refusal that says the list is read again: the reports and the planning. */
export function useRefreshReports(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: SCHEDULING_KEY }), [client]);
}

export function useRefreshPayRules(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: PAY_RULES_KEY }), [client]);
}
