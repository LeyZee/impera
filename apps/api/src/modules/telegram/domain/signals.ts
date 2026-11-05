import type {
  AlertRef,
  AutomaticMissing,
  ConnectionDownReason,
  ConnectionService,
  Currency,
  ConversationId,
  ContractorDocumentKind,
  CreatorId,
  HandoffCause,
  InvoiceKind,
  InvoiceNotIssuedReason,
  InvoicePdfPlace,
  KillSwitchScope,
  PayoutBlock,
  Platform,
  PayPeriod,
  SaleSeller,
  SaleType,
  SecurityAlertPayload,
  TelegramTopic,
} from '@impera/contracts';

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
      /**
       * Other bytes than the base's lie under a document's key (ADR 0037): nothing was replaced, nothing altered was
       * served. Its number and where, never the member.
       */
      readonly kind: 'invoice_pdf_conflict';
      readonly number: string;
      readonly place: InvoicePdfPlace;
      readonly stage: 'render' | 'copy' | 'download';
    }
  | {
      /** A document still has no PDF (`primary`), or its PDF no copy at the provider named, after the last attempt. */
      readonly kind: 'invoice_pdf_missing';
      readonly number: string;
      readonly place: InvoicePdfPlace;
    }
  | {
      /** A contractor contested one of their documents (ADR 0039 § 2): its number and kind, never the reason nor a name. */
      readonly kind: 'invoice_contested';
      readonly number: string;
      readonly document: InvoiceKind;
    }
  | {
      /**
       * An invoice not settled comes to its due date (`overdue` false, from seven days before) or passed it (EQ-06 lot
       * 8): its number, its due date and what blocks the transfer that will pay it (ADR 0041); never the amount nor a
       * name, the member's id for the link to their file.
       */
      readonly kind: 'invoice_due';
      readonly overdue: boolean;
      readonly memberId: string;
      readonly number: string;
      readonly dueOn: string;
      readonly payoutBlock: PayoutBlock | null;
    }
  | {
      /**
       * A document a contractor's regime asks for comes to its end with no newer one filed (EQ-06 lot 5c-2): its kind
       * and last day, and the member's id for the link to their file; never a name.
       */
      readonly kind: 'contractor_document_expiring';
      readonly memberId: string;
      readonly document: ContractorDocumentKind;
      readonly lastDay: string;
    }
  | {
      /**
       * A fresh sale read in a platform's register (CRM-04 lot b): its kind, the price the fan paid (VAT included, the
       * figure the team sees in the platform), when it happened (its day picks the rate of a dollar sale against the
       * minimum) and who sold it. Never the fan, never the sale's key.
       */
      readonly kind: 'sale';
      readonly saleType: SaleType;
      readonly occurredAt: Date;
      readonly currency: Currency;
      readonly grossInclVatMinor: number;
      readonly seller: SaleSeller;
    }
  | {
      /** Automatique closed on its own (ADR 0019): its conversations went back to the copilot. */
      readonly kind: 'automatic_closed';
      /** What the lock misses now, with the server's figures. */
      readonly missing: readonly AutomaticMissing[];
      readonly conversations: number;
    }
  | {
      /**
       * A security alert (ADR 0046 § 8): which act, the account's role and its network, never a name nor a full
       * address. The ids it carries are not shown.
       */
      readonly kind: 'security_alert';
      readonly alert: SecurityAlertPayload;
    }
  | {
      /**
       * After a switch to the platform's net (CRM-04 b3): a fortnight's automatic check still finds the register and
       * the platform's statistics apart, 24 hours later. Only how many days and accounts: never an amount.
       */
      readonly kind: 'sales_feed_mismatch';
      readonly platform: Platform;
      readonly from: PayPeriod;
      readonly days: number;
      readonly accounts: number;
    }
  | {
      /**
       * A service the agent needs went down (P3-12): which one and why, never the key nor a word of its answer.
       * Published at the transition only (Bilan's `connection_state_changed`).
       */
      readonly kind: 'connection_down';
      readonly service: ConnectionService;
      readonly reason: ConnectionDownReason;
    }
  | { readonly kind: 'connection_back'; readonly service: ConnectionService }
  | {
      /**
       * Her share read on the platform strays from the agency's percentage set for her, by more than a cent a sale or
       * refund, on one account and fortnight (CRM-04 d3, ADR 0054 § 2). For the owner, as information: never an amount,
       * the percentage, a fan nor a chatter.
       */
      readonly kind: 'agency_share_mismatch';
      readonly creatorId: CreatorId;
      readonly platform: Platform;
      readonly platformAccountId: string;
      readonly from: PayPeriod;
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
  /** To the groups « pour toutes » only, even for an event of hers: what the agency alone should read (CRM-04 d3). */
  readonly allCreatorsOnly?: true;
  /** Nothing more once the thread has a message: one fact published in several events (one per currency) is told once. */
  readonly oncePerThread?: true;
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
