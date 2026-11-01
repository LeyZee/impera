import {
  AlertRefSchema,
  AutomaticMissingSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  HandoffCauseSchema,
  InvoiceKindSchema,
  InvoiceNotIssuedReasonSchema,
  KillSwitchScopeSchema,
  PayPeriodSchema,
} from '@nirvana/contracts';
import { z } from 'zod';

import type { ScannedEvent, Signal } from '../domain/signals';

/**
 * Reads a `domain_events` row into a signal (ADR 0020 §3). Local, tolerant schemas: the module reads the facts it
 * needs and nothing else, accepts rows written before a field existed, and skips a row it cannot read rather than
 * blocking the scan behind it. Types without a producer yet (sales, validations) give `null` here until their payload
 * enters the contract.
 */

const HandoffSchema = z.object({
  conversationId: ConversationIdSchema.optional().catch(undefined),
  cause: HandoffCauseSchema.optional().catch(undefined),
  // Which alert of hers paused the agent, to name it; a trigger it cannot read never holds the handoff back.
  trigger: z.object({ alert: AlertRefSchema }).optional().catch(undefined),
});

// `conversationId` since #60 on `takeover_started`; a row without it (an older one) closes nothing.
const TakeoverSchema = z.object({
  conversationId: ConversationIdSchema.optional().catch(undefined),
  userId: z.string().min(1).optional().catch(undefined),
});

const BudgetSchema = z.object({
  kind: z.enum(['alert', 'reached']),
  spentMinor: z.number().int().min(0),
  capMinor: z.number().int().min(0),
});

const SessionSchema = z.object({
  platformAccountId: z.string().min(1),
  from: z.string(),
  to: z.string(),
});

const KillSwitchSchema = z.object({
  scope: KillSwitchScopeSchema,
  scopeId: z.string().nullable(),
  active: z.boolean(),
  reason: z.string(),
});

// Only which alert rang: how it matched and the declared word stay out (the word is what the fan wrote too). Sent only
// when her alert asked for it at the time (`notify`, true for the system's); a row without it is not sent.
const AlertTriggeredSchema = z.object({
  conversationId: ConversationIdSchema,
  trigger: z.object({ alert: AlertRefSchema }),
  notify: z.boolean(),
});

// Only the last failure counts: the retries before it are the platform's hiccups, not news. No fallback on the
// attempt count for rows without `isFinal`: the outbox never held `send_failed` before the flag existed. The
// error code stays out, as anything the platform said.
const SendFailedSchema = z.object({
  conversationId: ConversationIdSchema.optional().catch(undefined),
  isFinal: z.literal(true),
});

// The voice version (`voicePrompt`, `voiceModel`) stays out: Telegram never gets anything of the voice.
const AutomaticClosedSchema = z.object({
  missing: z.array(AutomaticMissingSchema).min(1),
  conversations: z.number().int().min(1),
});

const BackupOverdueSchema = z.object({ lastSucceededAt: z.iso.datetime().nullable() });

// Only the currency and the ECB's day of its last rate: no figure of the agency's pay goes to Telegram (ADR 0033).
const ExchangeRateOverdueSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  lastRateDay: z.iso.date().nullable(),
});

// The period, the document and the reason only: the member and the amount stay in Nirvana (no figure of the pay goes to
// Telegram, ADR 0033).
const InvoiceNotIssuedSchema = z.object({
  period: PayPeriodSchema,
  document: InvoiceKindSchema,
  reason: InvoiceNotIssuedReasonSchema,
});

function signalOf(type: string, payload: unknown): Signal | null {
  switch (type) {
    case 'handoff_requested': {
      const parsed = HandoffSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        kind: 'handoff',
        conversationId: parsed.data.conversationId ?? null,
        cause: parsed.data.cause ?? null,
        ...(parsed.data.trigger !== undefined && { alert: parsed.data.trigger.alert }),
      };
    }
    case 'takeover_started': {
      const parsed = TakeoverSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        kind: 'takeover',
        conversationId: parsed.data.conversationId ?? null,
        userId: parsed.data.userId ?? null,
      };
    }
    case 'takeover_ended': {
      const parsed = TakeoverSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        kind: 'release',
        conversationId: parsed.data.conversationId ?? null,
        userId: parsed.data.userId ?? null,
      };
    }
    case 'budget_threshold_crossed': {
      const parsed = BudgetSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        kind: 'budget',
        threshold: parsed.data.kind,
        spentMinor: parsed.data.spentMinor,
        capMinor: parsed.data.capMinor,
      };
    }
    case 'session_state_changed': {
      const parsed = SessionSchema.safeParse(payload);
      if (!parsed.success) return null;
      const { platformAccountId, from, to } = parsed.data;
      if (to === 'expired' && from !== 'expired') return { kind: 'session_expired', platformAccountId };
      if (to === 'valid' && from === 'expired') return { kind: 'session_back', platformAccountId };
      return null;
    }
    case 'kill_switch_toggled': {
      const parsed = KillSwitchSchema.safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'kill_switch', ...parsed.data };
    }
    case 'alert_triggered': {
      const parsed = AlertTriggeredSchema.safeParse(payload);
      if (!parsed.success || !parsed.data.notify) return null;
      return { kind: 'alert', conversationId: parsed.data.conversationId, alert: parsed.data.trigger.alert };
    }
    case 'send_failed': {
      const parsed = SendFailedSchema.safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'send_failed', conversationId: parsed.data.conversationId ?? null };
    }
    case 'backup_overdue': {
      const parsed = BackupOverdueSchema.safeParse(payload);
      if (!parsed.success) return null;
      const { lastSucceededAt } = parsed.data;
      return {
        kind: 'backup_overdue',
        lastSucceededAt: lastSucceededAt === null ? null : new Date(lastSucceededAt),
      };
    }
    case 'exchange_rate_overdue': {
      const parsed = ExchangeRateOverdueSchema.safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'exchange_rate_overdue', ...parsed.data };
    }
    case 'invoice_not_issued': {
      const parsed = InvoiceNotIssuedSchema.safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'invoice_not_issued', ...parsed.data };
    }
    case 'automatic_closed': {
      const parsed = AutomaticClosedSchema.safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'automatic_closed', ...parsed.data };
    }
    default:
      return null;
  }
}

export interface EventRow {
  readonly id: string;
  readonly creatorId: string | null;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

/** Null for a row the module has nothing to say about. */
export function toScannedEvent(row: EventRow): ScannedEvent | null {
  const signal = signalOf(row.type, row.payload);
  if (signal === null) return null;
  if (row.creatorId === null) return { id: row.id, creatorId: null, createdAt: row.createdAt, signal };
  const creatorId = CreatorIdSchema.safeParse(row.creatorId);
  return creatorId.success
    ? { id: row.id, creatorId: creatorId.data, createdAt: row.createdAt, signal }
    : null;
}
