import {
  EVENT_PAYLOADS,
  type ConversationId,
  type CreatorAlertCode,
  type HandoffCause,
} from '@impera/contracts';

/**
 * Which alert of a creator's tab an event of the outbox is (ADR 0150 § B), pure. A table of the code, never a prompt.
 * Nothing of what a fan wrote is read: only the event's kind, its cause, and the conversation to open.
 */
export interface ClassifiedAlert {
  readonly code: CreatorAlertCode;
  /** The conversation the notification opens, when the event names one. */
  readonly conversationId: ConversationId | null;
}

/** The human relays for safety (ADR 0150 § 6): locked on « reçoit » for every role. */
export const SAFETY_HANDOFF_CAUSES = [
  'minor',
  'non_consent',
  'distress',
  'meeting',
  'manipulation',
] as const satisfies readonly HandoffCause[];
const SAFETY_CAUSES: ReadonlySet<HandoffCause> = new Set(SAFETY_HANDOFF_CAUSES);

function handoffAlert(cause: HandoffCause): CreatorAlertCode | null {
  if (SAFETY_CAUSES.has(cause)) return 'safety_handoff';
  if (cause === 'identity_doubt') return 'identity_doubt';
  if (cause === 'keyword' || cause === 'custom_alert') return 'her_alerts';
  // A custom order is something sold outside the scripts, asked by the fan (ADR 0150 § 12).
  if (cause === 'custom_order') return 'offer_proposed';
  return null;
}

/** The event types this router reads; any other is skipped without being parsed. */
export const ROUTED_EVENT_TYPES = [
  'handoff_requested',
  'alert_triggered',
  'sale_detected',
  'budget_threshold_crossed',
  'ai_credits_low',
  'session_state_changed',
  'scripts_exhausted',
  'offer_proposed',
  'account_uncovered',
] as const;

/** The alert an event is, or null when it is none of the tab's (or its payload does not read). */
export function classifyEvent(type: string, payload: unknown): ClassifiedAlert | null {
  switch (type) {
    case 'handoff_requested': {
      const parsed = EVENT_PAYLOADS.handoff_requested.safeParse(payload);
      if (!parsed.success) return null;
      const code = handoffAlert(parsed.data.cause);
      return code === null ? null : { code, conversationId: parsed.data.conversationId };
    }
    case 'alert_triggered': {
      const parsed = EVENT_PAYLOADS.alert_triggered.safeParse(payload);
      if (!parsed.success) return null;
      const { alert } = parsed.data.trigger;
      const conversationId = parsed.data.conversationId;
      if (alert.kind === 'custom' || alert.code === 'keyword') return { code: 'her_alerts', conversationId };
      if (alert.code === 'identity_doubt') return { code: 'identity_doubt', conversationId };
      if (alert.code === 'script_price') return { code: 'script_price', conversationId };
      // A service the fan asks for (call, cam, voice, custom content): an offer outside the scripts (§ 12).
      return { code: 'offer_proposed', conversationId };
    }
    case 'sale_detected':
      return { code: 'sale', conversationId: null };
    case 'budget_threshold_crossed':
    case 'ai_credits_low':
      return { code: 'ai_budget', conversationId: null };
    case 'session_state_changed': {
      const parsed = EVENT_PAYLOADS.session_state_changed.safeParse(payload);
      return parsed.success && parsed.data.to === 'expired' && parsed.data.from !== 'expired'
        ? { code: 'session_expired', conversationId: null }
        : null;
    }
    case 'scripts_exhausted': {
      const parsed = EVENT_PAYLOADS.scripts_exhausted.safeParse(payload);
      return parsed.success
        ? { code: 'scripts_exhausted', conversationId: parsed.data.conversationId }
        : null;
    }
    case 'offer_proposed': {
      const parsed = EVENT_PAYLOADS.offer_proposed.safeParse(payload);
      return parsed.success ? { code: 'offer_proposed', conversationId: parsed.data.conversationId } : null;
    }
    case 'account_uncovered':
      return EVENT_PAYLOADS.account_uncovered.safeParse(payload).success
        ? { code: 'uncovered_account', conversationId: null }
        : null;
    default:
      return null;
  }
}
