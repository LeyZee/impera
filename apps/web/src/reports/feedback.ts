import {
  ApiErrorSchema,
  SHIFT_FEEDBACK_ERROR_CODES,
  ShiftFeedbackListSchema,
  ShiftFeedbackReadSchema,
  ShiftFeedbackSchema,
  type DraftReason,
  type PayPeriod,
  type PutShiftFeedbackBody,
  type ReportSignalCategory,
  type ShiftFeedback,
  type ShiftFeedbackErrorCode,
  type ShiftFeedbackList,
  type ShiftFeedbackRead,
  type ShiftIncidentStep,
} from '@impera/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { SCHEDULING_KEY } from '@/scheduling/api';

/**
 * The mini feedback of a shift on an account whose pay reads the sales (ADR 0050 § 10), and the follow-up of its
 * incident (trous béants n° 1): `/v1/scheduling/shifts/:shiftId/feedback` for the member,
 * `/v1/scheduling/shift-feedback` for Équipe › Rapports. Every answer is parsed with the contract.
 */

const FEEDBACK_KEY = [...SCHEDULING_KEY, 'shift-feedback'] as const;

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

/** A shift's feedback, `null` before it is sent. */
export function useShiftFeedback(shiftId: string, enabled = true): UseQueryResult<ShiftFeedbackRead> {
  return useQuery({
    queryKey: [...FEEDBACK_KEY, 'shift', shiftId],
    queryFn: () =>
      read(`/v1/scheduling/shifts/${shiftId}/feedback`, (body) => ShiftFeedbackReadSchema.parse(body)),
    enabled,
  });
}

/** A period's feedbacks; without a period, the incidents not « Réglé » yet. Read again every minute: an incident waits. */
export function useShiftFeedbacks(
  period: PayPeriod | null,
  enabled = true,
): UseQueryResult<ShiftFeedbackList> {
  return useQuery({
    queryKey: [...FEEDBACK_KEY, 'list', period],
    queryFn: () =>
      read(
        period === null ? '/v1/scheduling/shift-feedback' : `/v1/scheduling/shift-feedback?period=${period}`,
        (body) => ShiftFeedbackListSchema.parse(body),
      ),
    enabled,
    refetchInterval: period === null ? 60_000 : false,
  });
}

export type FeedbackRefusalCode =
  ShiftFeedbackErrorCode | 'shift_not_found' | 'role_forbidden' | 'request_invalid';

export type FeedbackOutcome =
  | { readonly kind: 'ok'; readonly value: ShiftFeedback }
  | { readonly kind: 'refused'; readonly code: FeedbackRefusalCode }
  | { readonly kind: 'failed' };

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...SHIFT_FEEDBACK_ERROR_CODES,
  'shift_not_found',
  'role_forbidden',
  'request_invalid',
]);
const isKnown = (code: string): code is FeedbackRefusalCode => KNOWN.has(code);

async function write(method: 'PUT' | 'POST', url: string, body: unknown): Promise<FeedbackOutcome> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', value: ShiftFeedbackSchema.parse(await response.json()) };
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || !isKnown(parsed.data.error.code)) return { kind: 'failed' };
    return { kind: 'refused', code: parsed.data.error.code };
  } catch {
    return { kind: 'failed' };
  }
}

/** The member's feedback; a retry with the same `id` and the same words answers the one recorded. */
export const sendFeedback = (shiftId: string, body: PutShiftFeedbackBody): Promise<FeedbackOutcome> =>
  write('PUT', `/v1/scheduling/shifts/${shiftId}/feedback`, body);

/** « Vu » or « Réglé » on an incident, by the owner or an active manager. */
export const stepIncident = (feedbackId: string, step: ShiftIncidentStep): Promise<FeedbackOutcome> =>
  write('POST', `/v1/scheduling/shift-feedback/${feedbackId}/incident`, { step });

/** After a write: the feedbacks, and the planning they hang on. */
export function useRefreshFeedbacks(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: FEEDBACK_KEY }), [client]);
}

export const FEEDBACK_ERRORS: Readonly<Record<FeedbackRefusalCode, string>> = {
  shift_not_found: 'Ce shift n’existe plus ou a été annulé.',
  shift_feedback_conflict: 'Ce retour a déjà été envoyé avec d’autres mots : il est relu.',
  shift_feedback_exists_conflict: 'Ce shift a déjà son retour : il est relu.',
  shift_feedback_early_conflict: 'Le retour se fait à la fin du shift, 30 minutes avant au plus tôt.',
  shift_feedback_declared_conflict:
    'Sur ce compte, c’est le rapport de fin de shift qui se fait : rouvre-le.',
  shift_feedback_forbidden: 'Ce retour est celui du membre du shift.',
  shift_feedback_not_found: 'Ce retour n’existe plus, ou ne porte pas d’incident : la liste est relue.',
  shift_incident_forbidden: 'Ton propre incident se suit par quelqu’un d’autre.',
  shift_feedback_fan_conflict: 'Ce fan n’est plus dans la liste de ton shift : choisis-en un autre.',
  shift_feedback_reason_conflict: 'La question sur les brouillons ne se pose plus pour ce shift.',
  shift_feedback_expired_conflict:
    'Ce retour a expiré : un shift plus récent a pris sa place. Il compte comme « sans retour ».',
  role_forbidden: 'Ton rôle ne permet pas ce geste.',
  request_invalid: 'Ces mots ne conviennent pas : vérifie les textes.',
};

/**
 * A signal's category, as the chatter picks it and the agency reads it: `kind` 1 to 6 is its `data-kind`, and `content`
 * its own hue of the design system's content palette (--nv-content-*, Design, 26/11), the same on chips, labels and
 * the donut. None is the red, amber or cyan the incidents and « sans souci » read by.
 */
export const SIGNAL_CATEGORIES: Readonly<
  Record<
    ReportSignalCategory,
    { readonly label: string; readonly kind: 1 | 2 | 3 | 4 | 5 | 6; readonly content: 1 | 2 | 3 | 4 | 5 | 10 }
  >
> = {
  fan_request: { label: 'Demande d’un fan', kind: 1, content: 3 },
  missing_script: { label: 'Script manquant', kind: 2, content: 1 },
  missing_content: { label: 'Contenu manquant', kind: 3, content: 2 },
  agent: { label: 'L’agent', kind: 4, content: 5 },
  idea: { label: 'Une idée', kind: 5, content: 4 },
  other: { label: 'Autre', kind: 6, content: 10 },
};

/** The closed question on the corrected drafts (ADR 0170 § 1), each answer as the chatter reads it. */
export const DRAFT_REASON_WORDS: Readonly<Record<DraftReason, string>> = {
  too_long: 'Trop longs',
  not_her_voice: 'Pas dans sa façon d’écrire',
  sale_too_early: 'Une vente proposée trop tôt',
  forgot_fan: 'Il oubliait ce que le fan avait dit',
  other: 'Autre chose',
};

/** Where an incident stands: sent, « Vu », « Réglé ». `null` without an incident. */
export type IncidentStage = 'sent' | 'seen' | 'resolved';

export function incidentStage(
  feedback: Pick<ShiftFeedback, 'incident' | 'incidentSeenAt' | 'incidentResolvedAt'>,
): IncidentStage | null {
  if (feedback.incident === null) return null;
  if (feedback.incidentResolvedAt !== null) return 'resolved';
  return feedback.incidentSeenAt === null ? 'sent' : 'seen';
}

export const STAGE_WORDS: Readonly<Record<IncidentStage, string>> = {
  sent: 'Envoyé',
  seen: 'Vu',
  resolved: 'Réglé',
};
