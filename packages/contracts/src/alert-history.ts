import { z } from 'zod';

import {
  AlertTriggerSchema,
  CustomAlertGroupIdSchema,
  SystemAlertCodeSchema,
  type AlertTrigger,
  type SystemAlertCode,
} from './alerts';
import { PageQuerySchema } from './conversations';
import { ConversationIdSchema, CreatorIdSchema, EventIdSchema, FanIdSchema } from './ids';

/**
 * The history of her alerts (P4-01), a sub-view of the Suivi (ADR 0024): every `alert_triggered`, and every
 * `handoff_requested` that carries a `trigger`, of one creator, newest first. It is not a second inbox: what asks for a
 * hand is in « À traiter », and the history has no red count. A « vu » is the agency's, one for the whole team.
 */

/** What the screen and the history call each system alert. */
export const SYSTEM_ALERT_LABELS: Readonly<Record<SystemAlertCode, string>> = {
  keyword: 'Mot-clé de sa persona',
  service_request: 'Demande de service',
  identity_doubt: 'Doute sur la personne',
  script_price: 'Prix d’un script changé',
};

/**
 * The line the history shows for a trigger, written by the code from the alert's name or the system's code, and from
 * the word she declared: never a word of the fan's beyond it (ADR 0020).
 */
export function alertTriggerReason(trigger: AlertTrigger, alertName: string): string {
  if (trigger.keyword !== undefined) {
    return trigger.alert.kind === 'custom'
      ? `Le fan a écrit « ${trigger.keyword} », un mot de l’alerte « ${alertName} ».`
      : `Le fan a écrit « ${trigger.keyword} », un mot surveillé de sa persona.`;
  }
  if (trigger.alert.kind === 'custom') return `Le message du fan correspond à l’alerte « ${alertName} ».`;
  switch (trigger.alert.code) {
    case 'keyword':
      return 'Le fan a écrit un mot surveillé de sa persona.';
    case 'service_request':
      return 'Le fan demande un service (contenu sur mesure, appel, cam ou vocal).';
    case 'identity_doubt':
      return 'Le fan doute de parler vraiment à la créatrice.';
    case 'script_price':
      return 'Le prix d’une étape sur la plateforme n’est plus celui décidé : l’étape ne part jamais, même alerte coupée. Active, un humain est aussi prévenu, sans pause.';
  }
}

/**
 * What the agent's own safety did, listed with her alerts (recette 16/11 AGE-05) though no alert of hers rang: a fan
 * who might be a minor (`handoff_requested` of cause `minor`), a care mode opened (`care_opened`), her AI budget
 * reached (`handoff_requested` of cause `budget`).
 */
export const SAFETY_EVENTS = ['minor', 'care', 'budget'] as const;
export const SafetyEventSchema = z.enum(SAFETY_EVENTS);
export type SafetyEvent = z.infer<typeof SafetyEventSchema>;

/** What the screen and the history call each of them. */
export const SAFETY_EVENT_LABELS: Readonly<Record<SafetyEvent, string>> = {
  minor: 'Âge douteux',
  care: 'Mode soin',
  budget: 'Budget IA atteint',
};

/** The line the history shows for one of them, written by the code: never a word of the fan's. */
export function safetyEventReason(event: SafetyEvent): string {
  switch (event) {
    case 'minor':
      return 'Le fan pourrait être mineur : l’agent s’est arrêté et attend un humain.';
    case 'care':
      return 'Le fan semble aller mal : le mode soin est ouvert, chaque réponse attend la validation d’un humain.';
    case 'budget':
      return 'Le budget IA de la créatrice est atteint : l’agent s’est arrêté et attend un humain.';
  }
}

/**
 * One line. `id` is the event's. `trigger` is the alert that rang, `safety` what the agent's safety did instead: one
 * of the two, never both. `alertGroupId` and `alertName` name her alert as it was, archived since or not;
 * `alertName` is the system's label for a system alert. `pausedAgent`: the alert handed the conversation to a human
 * (a `handoff_requested`), and its line is in « À traiter » too. `seenAt`: when someone of the agency marked it
 * seen.
 */
export const AlertTriggerItemSchema = z
  .object({
    id: EventIdSchema,
    creatorId: CreatorIdSchema,
    conversationId: ConversationIdSchema,
    fanId: FanIdSchema,
    fanDisplayName: z.string(),
    trigger: AlertTriggerSchema.nullable(),
    safety: SafetyEventSchema.nullable(),
    alertGroupId: CustomAlertGroupIdSchema.nullable(),
    alertName: z.string(),
    pausedAgent: z.boolean(),
    reason: z.string(),
    at: z.iso.datetime(),
    seenAt: z.iso.datetime().nullable(),
  })
  .refine((item) => (item.trigger === null) !== (item.safety === null), {
    message: 'Exactly one of trigger and safety',
  });
export type AlertTriggerItem = z.infer<typeof AlertTriggerItemSchema>;

/**
 * `GET /v1/alerts/triggers?creatorId=` (owner, an operator who reads the whole creator): her triggers, newest first,
 * by cursor pages. The cursor names the last trigger of its page, whose place is read again in the base: no date is
 * rounded. `seen` keeps the seen ones (`true`) or the others (`false`); `alert` keeps one alert, her own by its
 * `groupId`, the system's by its code, or one kind of the agent's safety. 400 `cursor_invalid` when the cursor names no trigger of hers.
 */
export const AlertTriggerQuerySchema = PageQuerySchema.extend({
  creatorId: CreatorIdSchema,
  seen: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  alert: z.union([CustomAlertGroupIdSchema, SystemAlertCodeSchema, SafetyEventSchema]).optional(),
});
export type AlertTriggerQuery = z.infer<typeof AlertTriggerQuerySchema>;

/** `POST /v1/alerts/triggers/:id/seen?creatorId=` → 204: seen once, and again is the same (idempotent). */
export const AlertTriggerSeenParamsSchema = z.object({ id: EventIdSchema });

/**
 * `POST /v1/alerts/triggers/seen` → 200: « Tout marquer comme vu ». Every trigger of the creator up to `untilId`,
 * the newest one the screen shows, that one included, is seen: one come since stays unseen. The order is the list's,
 * read in the base (`created_at` to the microsecond, then `id`), never a date sent back rounded. `alert` keeps the
 * list's filter: what the screen does not show is not marked. 404 `alert_trigger_not_found` when `untilId` is not
 * hers.
 */
export const MarkAlertTriggersSeenBodySchema = z.object({
  creatorId: CreatorIdSchema,
  untilId: EventIdSchema,
  alert: z.union([CustomAlertGroupIdSchema, SystemAlertCodeSchema, SafetyEventSchema]).optional(),
});
export type MarkAlertTriggersSeenBody = z.infer<typeof MarkAlertTriggersSeenBodySchema>;
export const MarkAlertTriggersSeenResultSchema = z.object({ marked: z.number().int().min(0) });
export type MarkAlertTriggersSeenResult = z.infer<typeof MarkAlertTriggersSeenResultSchema>;

/**
 * The error codes of `/v1/alerts/triggers`, for the screen to say them in French (the suffix gives the status,
 * api.md): `alert_trigger_not_found` 404, no trigger of hers by that id ; `cursor_invalid` 400, a cursor that is not
 * one of this list's.
 */
export const ALERT_HISTORY_ERROR_CODES = ['alert_trigger_not_found', 'cursor_invalid'] as const;
export type AlertHistoryErrorCode = (typeof ALERT_HISTORY_ERROR_CODES)[number];
