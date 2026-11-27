import type {
  AutomaticMissing,
  ConnectionDownReason,
  ConnectionService,
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
  SecurityAlertPayload,
} from '@impera/contracts';

/**
 * What the agency's alerts read out of a `domain_events` row (ADR 0020 §3, kept by the decision « Telegram pour les
 * canaux seulement »), narrowed to the facts a notification needs. Nothing here can hold a fan's words: there is no
 * free-text field coming from a fan.
 */

/** How loud a notice is: `urgent` rings through the quiet hours (`agency_urgent`), the others wait for the morning. */
type AgencyTopic = 'urgent' | 'important' | 'info';

export type Signal =
  | {
      readonly kind: 'handoff';
      readonly conversationId: ConversationId | null;
      /** `null` for an event written before the cause existed (#54): it ranks as important. */
      readonly cause: HandoffCause | null;
    }
  | {
      readonly kind: 'budget';
      readonly threshold: 'alert' | 'reached';
      readonly spentMinor: number;
      readonly capMinor: number;
    }
  | {
      readonly kind: 'kill_switch';
      readonly active: boolean;
      readonly scope: KillSwitchScope;
      readonly scopeId: string | null;
      /** Typed by someone of the agency in the CRM; escaped and cut when rendered. */
      readonly reason: string;
    }
  | {
      /** A message of the agent will never leave (last attempt, or refused): the conversation is in `error`. */
      readonly kind: 'send_failed';
      readonly conversationId: ConversationId | null;
    }
  | {
      /**
       * A provider's AI credits, as the CRM's ledger counts them down (ADR 0091 § 4): under five days (`low`), under
       * two (`critical`) or none left (`empty`). The amount is the agency's own spending, never a creator's figure.
       */
      readonly kind: 'ai_credits_low';
      readonly provider: 'xai' | 'mistral' | 'google';
      readonly level: 'low' | 'critical' | 'empty';
      readonly balanceMinor: number;
      readonly currency: 'EUR' | 'USD';
      readonly runsOutOn: string | null;
    }
  | {
      /**
       * A provider refused a call for lack of credits or of its subscription's quota (ADR 0091 § 6): the agent goes on
       * with its fallback model. Never the provider's answer.
       */
      readonly kind: 'ai_quota_exhausted';
      readonly provider: 'xai' | 'mistral' | 'google';
      readonly mode: 'credits' | 'subscription';
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
       * A model linked to one of her accounts is gone from the platform's list, or listed `banned` (ADR 0069 § 5,
       * CRM-07 a2): nothing is deleted. Never her name nor the model's id: a group may hold managers.
       */
      readonly kind: 'sales_feed_model';
      readonly platform: Platform;
      readonly change: 'gone' | 'banned';
      readonly platformModelId: string;
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
    }
  | {
      /**
       * The agency's share read on the platform moved by more than a point from one fortnight to the next, on one
       * account (ADR 0054 § 5). For the owner, as information: never an amount, a share, a fan nor a chatter.
       */
      readonly kind: 'agency_share_changed';
      readonly creatorId: CreatorId;
      readonly platform: Platform;
      readonly platformAccountId: string;
      readonly from: PayPeriod;
    }
  | {
      /**
       * A créneau began on one of her accounts with nobody answering (ADR 0094 § 1, « compte sans personne »). For the
       * owner and the managers: no fan, no chatter.
       */
      readonly kind: 'account_uncovered';
      readonly creatorId: CreatorId;
      readonly platform: Platform;
      readonly platformAccountId: string;
      readonly slotStartsAt: string;
      readonly slotEndsAt: string;
      readonly timeZone: string;
    };

export interface ScannedEvent {
  /** `domain_events.id`: the key of the notifications it produces. */
  readonly id: string;
  readonly creatorId: CreatorId | null;
  readonly signal: Signal;
}

/** A new notification for the owners. */
export interface Notice {
  readonly kind: 'notice';
  readonly topic: AgencyTopic;
  /** The fact the notice is about (a conversation, a service); null when it stands alone. */
  readonly threadKey: string | null;
  /** Told once per thread: one fact published in several events (one per currency) rings once. */
  readonly oncePerThread?: true;
  readonly title: string;
  readonly body: string;
  readonly link: { readonly label: string; readonly path: string } | null;
  /** Shown without sound nor vibration (a service back). */
  readonly silent?: true;
  /** A later notice of the same tag replaces this one on the screen (an outage, then its end). */
  readonly tag?: string;
}
