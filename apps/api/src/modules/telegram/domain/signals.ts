import type {
  AlertRef,
  AutomaticMissing,
  ConversationId,
  CreatorId,
  HandoffCause,
  InvoiceKind,
  InvoiceNotIssuedReason,
  KillSwitchScope,
  PayPeriod,
  TelegramTopic,
} from '@nirvana/contracts';

/**
 * What the module reads out of a `domain_events` row (ADR 0020 §3), narrowed to the facts a notification needs.
 * Nothing here can hold a fan's words: there is no free-text field coming from a fan.
 */

export type Signal =
  | {
      readonly kind: 'handoff';
      readonly conversationId: ConversationId | null;
      /** `null` for an event written before the cause existed (#54): it ranks as important. */
      readonly cause: HandoffCause | null;
      /** The alert of hers that paused the agent (P4-01), named in the message; absent for any other cause. */
      readonly alert?: AlertRef;
    }
  | {
      readonly kind: 'takeover';
      readonly conversationId: ConversationId | null;
      readonly userId: string | null;
    }
  | {
      /** A person gave the conversation back to the agent: whatever needed a human was dealt with. */
      readonly kind: 'release';
      readonly conversationId: ConversationId | null;
      readonly userId: string | null;
    }
  | {
      readonly kind: 'budget';
      readonly threshold: 'alert' | 'reached';
      readonly spentMinor: number;
      readonly capMinor: number;
    }
  | { readonly kind: 'session_expired'; readonly platformAccountId: string }
  | { readonly kind: 'session_back'; readonly platformAccountId: string }
  | {
      readonly kind: 'kill_switch';
      readonly active: boolean;
      readonly scope: KillSwitchScope;
      readonly scopeId: string | null;
      /** Typed by someone of the agency in the CRM; escaped and cut when rendered. */
      readonly reason: string;
    }
  | {
      /**
       * One of her alerts lets a human know while the agent goes on (`alert_triggered`, P4-01): which alert, never
       * what the fan wrote. An alert that pauses the agent is a `handoff` instead.
       */
      readonly kind: 'alert';
      readonly conversationId: ConversationId;
      readonly alert: AlertRef;
    }
  | {
      /** A message of the agent will never leave (last attempt, or refused): the conversation is in `error`. */
      readonly kind: 'send_failed';
      readonly conversationId: ConversationId | null;
    }
  | {
      /** No export of the database succeeded for 26 hours (ADR 0028 § 5); null when none ever did. */
      readonly kind: 'backup_overdue';
      readonly lastSucceededAt: Date | null;
    }
  | {
      /**
       * No ECB rate of a currency pay converts for more than two weekdays (ADR 0033); `lastRateDay` is the ECB's day
       * of the last one, null when none ever came.
       */
      readonly kind: 'exchange_rate_overdue';
      readonly currency: string;
      readonly lastRateDay: string | null;
    }
  | {
      /**
       * A document a validated statement made due was not issued (EQ-06, ADR 0036): only its period, its kind and the
       * closed reason; never the member nor the amount.
       */
      readonly kind: 'invoice_not_issued';
      readonly period: PayPeriod;
      readonly document: InvoiceKind;
      readonly reason: InvoiceNotIssuedReason;
    }
  | {
      /** Automatique closed on its own (ADR 0019): its conversations went back to the copilot. */
      readonly kind: 'automatic_closed';
      /** What the lock misses now, with the server's figures. */
      readonly missing: readonly AutomaticMissing[];
      readonly conversations: number;
    };

export interface ScannedEvent {
  /** `domain_events.id`: the source key of every delivery it produces. */
  readonly id: string;
  readonly creatorId: CreatorId | null;
  readonly createdAt: Date;
  readonly signal: Signal;
}

/** A new message for the topic's groups. */
export interface Notice {
  readonly kind: 'notice';
  readonly topic: TelegramTopic;
  /** Lets a later event close the message (a takeover, a recovery); null when nothing ever will. */
  readonly threadKey: string | null;
  /**
   * Where the message goes when no group can get `topic`: a fan paused by one of her alerts is told to the
   * important groups rather than to nobody (P4-01).
   */
  readonly fallbackTopic?: TelegramTopic;
  readonly title: string;
  readonly body: string;
  readonly link: { readonly label: string; readonly path: string } | null;
}

/** A later event that closes earlier messages of the same thread, in each group that got them. */
export interface Closure {
  readonly kind: 'closure';
  readonly threadKey: string;
  /** `edit` rewrites the original message; `reply` answers it without a sound. */
  readonly mode: 'edit' | 'reply';
  readonly text: string;
  /** For an edit by a person: whose name to resolve (`userId`), shown as « Pris en main par … ». */
  readonly userId: string | null;
}

export type Outcome = Notice | Closure;
