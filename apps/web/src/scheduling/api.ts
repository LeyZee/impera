import {
  ApiErrorSchema,
  LeaveRequestListSchema,
  LeaveRequestSchema,
  MyShiftsSchema,
  OnDutyListSchema,
  PlanningSchema,
  SCHEDULING_ERROR_CODES,
  ShiftSchema,
  ShiftSwapListSchema,
  ShiftSwapRequestSchema,
  ShiftTemplateListSchema,
  ShiftTemplateSchema,
  SwapCandidatesSchema,
  type CreateLeaveRequestBody,
  type CreateShiftBody,
  type CreateShiftSwapRequestBody,
  type CreateShiftTemplateBody,
  type DecideLeaveRequestBody,
  type LeaveRequest,
  type LeaveRequestList,
  type MyShifts,
  type OnDuty,
  type Planning,
  type SchedulingErrorCode,
  type Shift,
  type ShiftSwapList,
  type ShiftSwapRequest,
  type ShiftTemplate,
  type SwapCandidates,
  type UpdateShiftBody,
} from '@nirvana/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

/**
 * `/v1/scheduling` as the screens read it (EQ-02): the planning of a week, who is on shift, the member's own shifts,
 * the leaves and the swaps (ADR 0031), and the writes. Every answer is parsed with the contract.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

export interface PlanningRange {
  readonly from: string;
  readonly to: string;
  readonly creatorId: string | null;
}

export function fetchPlanning(range: PlanningRange): Promise<Planning> {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (range.creatorId !== null) query.set('creatorId', range.creatorId);
  return read(`/v1/scheduling/planning?${query.toString()}`, (body) => PlanningSchema.parse(body));
}

/** Everything the planning shows, read again by every write. */
export const SCHEDULING_KEY = ['scheduling'] as const;

export function usePlanning(range: PlanningRange, enabled = true): UseQueryResult<Planning> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'planning', range.from, range.to, range.creatorId],
    queryFn: () => fetchPlanning(range),
    enabled,
    // One retry, not three: a silent server is said in about a second, not seven (EQ-22).
    retry: 1,
    // The week stays on screen while the next one loads: no blank grid between two weeks.
    placeholderData: (before) => before,
  });
}

/** Who is on shift right now: read again every minute, a shift starts or ends on the minute. */
export function useOnDuty(enabled: boolean): UseQueryResult<OnDuty[]> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'on-duty'],
    queryFn: () => read('/v1/scheduling/on-duty', (body) => OnDutyListSchema.parse(body).onDuty),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useTemplates(enabled: boolean): UseQueryResult<ShiftTemplate[]> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'templates'],
    queryFn: () =>
      read('/v1/scheduling/shift-templates', (body) => ShiftTemplateListSchema.parse(body).templates),
    enabled,
  });
}

/** The member's shift now, the next one and the one whose margin is still open (Aujourd'hui, Suivi). */
export function useMyShifts(): UseQueryResult<MyShifts> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'mine'],
    queryFn: () => read('/v1/scheduling/my-shifts', (body) => MyShiftsSchema.parse(body)),
    refetchInterval: 60_000,
    // One retry, then Aujourd'hui says the server does not answer, as the Dashboard does: not 8 s of skeleton (DASH-22).
    retry: 1,
  });
}

/**
 * The leaves that overlap [`from`, `to`): the reader's own for a chatter, every member's for the owner and an active
 * manager.
 */
export function useLeaves(range: {
  readonly from: string;
  readonly to: string;
}): UseQueryResult<LeaveRequestList> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'leaves', range.from, range.to],
    queryFn: () =>
      read(`/v1/scheduling/leave-requests?${new URLSearchParams(range).toString()}`, (body) =>
        LeaveRequestListSchema.parse(body),
      ),
    placeholderData: (before) => before,
  });
}

/** The open swaps and those of the last two weeks: the reader's own, or every one for the owner and a manager. */
export function useSwaps(): UseQueryResult<ShiftSwapList> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'swaps'],
    queryFn: () => read('/v1/scheduling/swap-requests', (body) => ShiftSwapListSchema.parse(body)),
    // A colleague's answer lands without a write here: read again every minute, like who is on shift.
    refetchInterval: 60_000,
  });
}

/** Who could take one of the reader's shifts, and what they could give back. */
export function useSwapCandidates(shiftId: string): UseQueryResult<SwapCandidates> {
  return useQuery({
    queryKey: [...SCHEDULING_KEY, 'candidates', shiftId],
    queryFn: () =>
      read(`/v1/scheduling/swap-candidates?shiftId=${shiftId}`, (body) => SwapCandidatesSchema.parse(body)),
  });
}

/** A refusal the screen words, or a server that does not answer. */
export type Refusal =
  | {
      readonly kind: 'refused';
      readonly code: SchedulingRefusalCode;
      /** The shift in the way, when the refusal names one. */
      readonly shiftId: string | null;
      /** The shifts still on a member during a leave (`leave_shifts_conflict`). */
      readonly shiftIds: readonly string[];
    }
  | { readonly kind: 'failed' };

/** Besides the planning's own: a role guard, and a body the server refuses that the screen should have caught. */
export type SchedulingRefusalCode = SchedulingErrorCode | 'role_forbidden' | 'request_invalid';

export type Outcome<T> = { readonly kind: 'ok'; readonly value: T } | Refusal;

const isSchedulingCode = (code: string): code is SchedulingErrorCode =>
  SCHEDULING_ERROR_CODES.some((known) => known === code);

const InTheWaySchema = z.object({ shiftId: z.string() });
const StillOnSchema = z.object({ shiftIds: z.array(z.string()) });

async function refusalOf(response: Response): Promise<Refusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'failed' };
  const { code, details } = parsed.data.error;
  // The 409s of a member or an account already taken name the shift in the way; a leave's, the shifts still on it.
  const inTheWay = InTheWaySchema.safeParse(details);
  const stillOn = StillOnSchema.safeParse(details);
  const refused = {
    shiftId: inTheWay.success ? inTheWay.data.shiftId : null,
    shiftIds: stillOn.success ? stillOn.data.shiftIds : [],
  };
  // A manager whose status changed since the page opened: the role guard, not a server down. A 400 the screen let
  // through is said as values that do not fit, not as a silent server.
  if (code === 'role_forbidden' || code === 'request_invalid') return { kind: 'refused', code, ...refused };
  return isSchedulingCode(code) ? { kind: 'refused', code, ...refused } : { kind: 'failed' };
}

async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
): Promise<Outcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: parse(response.status === 204 ? null : await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

export const createShift = (body: CreateShiftBody): Promise<Outcome<Shift>> =>
  send('POST', '/v1/scheduling/shifts', body, (json) => ShiftSchema.parse(json));

/** `null` when a stop falls in the shift's first minute: the server cancels it and answers 204. */
export const updateShift = (shiftId: string, body: UpdateShiftBody): Promise<Outcome<Shift | null>> =>
  send('PATCH', `/v1/scheduling/shifts/${shiftId}`, body, (json) =>
    json === null ? null : ShiftSchema.parse(json),
  );

export const cancelShift = (shiftId: string): Promise<Outcome<null>> =>
  send('DELETE', `/v1/scheduling/shifts/${shiftId}`, undefined, () => null);

export const createTemplate = (body: CreateShiftTemplateBody): Promise<Outcome<ShiftTemplate>> =>
  send('POST', '/v1/scheduling/shift-templates', body, (json) => ShiftTemplateSchema.parse(json));

export const endTemplate = (templateId: string): Promise<Outcome<null>> =>
  send('DELETE', `/v1/scheduling/shift-templates/${templateId}`, undefined, () => null);

export const askLeave = (body: CreateLeaveRequestBody): Promise<Outcome<LeaveRequest>> =>
  send('POST', '/v1/scheduling/leave-requests', body, (json) => LeaveRequestSchema.parse(json));

export const decideLeave = (
  leaveRequestId: string,
  body: DecideLeaveRequestBody,
): Promise<Outcome<LeaveRequest>> =>
  send('POST', `/v1/scheduling/leave-requests/${leaveRequestId}/decision`, body, (json) =>
    LeaveRequestSchema.parse(json),
  );

/** The member withdraws their pending request; the owner or an active manager cancels an approved leave. */
export const endLeave = (leaveRequestId: string): Promise<Outcome<null>> =>
  send('DELETE', `/v1/scheduling/leave-requests/${leaveRequestId}`, undefined, () => null);

export const proposeSwap = (body: CreateShiftSwapRequestBody): Promise<Outcome<ShiftSwapRequest>> =>
  send('POST', '/v1/scheduling/swap-requests', body, (json) => ShiftSwapRequestSchema.parse(json));

export const answerSwap = (
  shiftSwapRequestId: string,
  answer: 'accept' | 'decline',
): Promise<Outcome<ShiftSwapRequest>> =>
  send('POST', `/v1/scheduling/swap-requests/${shiftSwapRequestId}/answer`, { answer }, (json) =>
    ShiftSwapRequestSchema.parse(json),
  );

/** The requester or the agency withdraws a proposal; the agency reverts an accepted swap. */
export const endSwap = (shiftSwapRequestId: string): Promise<Outcome<null>> =>
  send('DELETE', `/v1/scheduling/swap-requests/${shiftSwapRequestId}`, undefined, () => null);

/**
 * After a write, and after a refusal that says « la liste est relue »: the week, who is on shift, the templates, the
 * leaves and the swaps are read again together.
 */
export function useRefreshPlanning(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: SCHEDULING_KEY }), [client]);
}
