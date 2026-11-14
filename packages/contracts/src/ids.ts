import { v7 } from 'uuid';
import { z } from 'zod';

/**
 * Application-generated UUID v7 identifiers (ADR 0011): sortable by time, branded so a `FanId` cannot be passed
 * where a `ConversationId` is expected. Platform identifiers stay opaque strings in `platform_<x>_id` fields.
 */
const uuid = z.uuid();

export const CreatorIdSchema = uuid.brand<'CreatorId'>();
export type CreatorId = z.infer<typeof CreatorIdSchema>;

export const PlatformAccountIdSchema = uuid.brand<'PlatformAccountId'>();
export type PlatformAccountId = z.infer<typeof PlatformAccountIdSchema>;

export const FanIdSchema = uuid.brand<'FanId'>();
export type FanId = z.infer<typeof FanIdSchema>;

export const ConversationIdSchema = uuid.brand<'ConversationId'>();
export type ConversationId = z.infer<typeof ConversationIdSchema>;

export const MessageIdSchema = uuid.brand<'MessageId'>();
export type MessageId = z.infer<typeof MessageIdSchema>;

export const DraftIdSchema = uuid.brand<'DraftId'>();
export type DraftId = z.infer<typeof DraftIdSchema>;

/** A calibration rating (`calibration_ratings`): the playground's, or a real draft's through the copilot panel. */
export const CalibrationRatingIdSchema = uuid.brand<'CalibrationRatingId'>();
export const DesireMarkIdSchema = uuid.brand<'DesireMarkId'>();
export type DesireMarkId = z.infer<typeof DesireMarkIdSchema>;

export const MediaAssetIdSchema = uuid.brand<'MediaAssetId'>();
export type MediaAssetId = z.infer<typeof MediaAssetIdSchema>;

export const MediaDescriptionIdSchema = uuid.brand<'MediaDescriptionId'>();
export type MediaDescriptionId = z.infer<typeof MediaDescriptionIdSchema>;

export const PersonaVersionIdSchema = uuid.brand<'PersonaVersionId'>();
export type PersonaVersionId = z.infer<typeof PersonaVersionIdSchema>;

export const PersonaCorrectionIdSchema = uuid.brand<'PersonaCorrectionId'>();
export type PersonaCorrectionId = z.infer<typeof PersonaCorrectionIdSchema>;

export const UserIdSchema = uuid.brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

/** A row of `conversation_events` or of the `domain_events` outbox. */
export const EventIdSchema = uuid.brand<'EventId'>();
export type EventId = z.infer<typeof EventIdSchema>;

export const AuditEntryIdSchema = uuid.brand<'AuditEntryId'>();
export type AuditEntryId = z.infer<typeof AuditEntryIdSchema>;

/** A row of `llm_calls`, the journal of every model call. */
export const LlmCallIdSchema = uuid.brand<'LlmCallId'>();
export type LlmCallId = z.infer<typeof LlmCallIdSchema>;

export const KillSwitchIdSchema = uuid.brand<'KillSwitchId'>();
export type KillSwitchId = z.infer<typeof KillSwitchIdSchema>;

/** A row of `blind_tests` (ADR 0019). */
export const BlindTestIdSchema = uuid.brand<'BlindTestId'>();
export type BlindTestId = z.infer<typeof BlindTestIdSchema>;

/** A fresh UUID v7 branded by the given schema: `newId(FanIdSchema)`. */
export function newId<S extends z.ZodType<string>>(schema: S): z.output<S> {
  return schema.parse(v7());
}

/** A member of the agency's team (ADR 0023), linked to one dashboard account (`user`). */
export const TeamMemberIdSchema = uuid.brand<'TeamMemberId'>();
export type TeamMemberId = z.infer<typeof TeamMemberIdSchema>;

export const TeamMemberNoteIdSchema = uuid.brand<'TeamMemberNoteId'>();
export type TeamMemberNoteId = z.infer<typeof TeamMemberNoteIdSchema>;

export const CommissionPresetIdSchema = uuid.brand<'CommissionPresetId'>();
export type CommissionPresetId = z.infer<typeof CommissionPresetIdSchema>;

export const CommissionRateIdSchema = uuid.brand<'CommissionRateId'>();
export type CommissionRateId = z.infer<typeof CommissionRateIdSchema>;

/** A member's team role from a date (`member_roles`, Charles 28/10). */
export const MemberRoleIdSchema = uuid.brand<'MemberRoleId'>();
export type MemberRoleId = z.infer<typeof MemberRoleIdSchema>;

/** A single-use link to choose a password, for a member's first access or a reset (EQ-10). */
export const InvitationLinkIdSchema = uuid.brand<'InvitationLinkId'>();
export type InvitationLinkId = z.infer<typeof InvitationLinkIdSchema>;

export const CalendarLinkIdSchema = uuid.brand<'CalendarLinkId'>();
export type CalendarLinkId = z.infer<typeof CalendarLinkIdSchema>;

/** A member's shift on one account of a creator (EQ-02). */
export const ShiftIdSchema = uuid.brand<'ShiftId'>();
export type ShiftId = z.infer<typeof ShiftIdSchema>;

/** A weekly shift that makes the shifts of the weeks ahead (EQ-02). */
export const ShiftTemplateIdSchema = uuid.brand<'ShiftTemplateId'>();
export type ShiftTemplateId = z.infer<typeof ShiftTemplateIdSchema>;

/** A member's request to be away for whole days, decided by the agency (EQ-02, ADR 0031). */
export const LeaveRequestIdSchema = uuid.brand<'LeaveRequestId'>();
export type LeaveRequestId = z.infer<typeof LeaveRequestIdSchema>;

/** A chatter's offer to give or exchange a shift with a colleague, who accepts or declines it (EQ-02, ADR 0031). */
export const ShiftSwapRequestIdSchema = uuid.brand<'ShiftSwapRequestId'>();
export type ShiftSwapRequestId = z.infer<typeof ShiftSwapRequestIdSchema>;

/** A chatter's end-of-shift report, or a correction of one once validated (EQ-03, ADR 0023). */
export const ShiftReportIdSchema = uuid.brand<'ShiftReportId'>();
export type ShiftReportId = z.infer<typeof ShiftReportIdSchema>;

/** A chatter's mini feedback at the end of a shift on an account whose sales are read (ADR 0050 § 10). */
export const ShiftFeedbackIdSchema = uuid.brand<'ShiftFeedbackId'>();
export type ShiftFeedbackId = z.infer<typeof ShiftFeedbackIdSchema>;

/** The pay rules of a platform account from a pay period on: currency, VAT, platform fee, earnings source (EQ-03). */
export const AccountPayRulesIdSchema = uuid.brand<'AccountPayRulesId'>();
export type AccountPayRulesId = z.infer<typeof AccountPayRulesIdSchema>;

/** The agency's percentage of a creator's net from a day on (ADR 0042 § 6, CR-04). */
export const CreatorAgencyRateIdSchema = uuid.brand<'CreatorAgencyRateId'>();
export type CreatorAgencyRateId = z.infer<typeof CreatorAgencyRateIdSchema>;

/** A member's commission statement for one pay period: `draft`, `validated`, `paid` (EQ-04, ADR 0023). */
export const CommissionStatementIdSchema = uuid.brand<'CommissionStatementId'>();
export type CommissionStatementId = z.infer<typeof CommissionStatementIdSchema>;

/** A manual bonus, with its reason, for a member and a pay period (EQ-04). */
export const BonusIdSchema = uuid.brand<'BonusId'>();
export type BonusId = z.infer<typeof BonusIdSchema>;

/** A penalty, fixed or a percent of the member's net, with its reason, over one or more pay periods (EQ-04). */
export const PenaltyIdSchema = uuid.brand<'PenaltyId'>();
export type PenaltyId = z.infer<typeof PenaltyIdSchema>;

/** A correction of a validated statement, carried on the member's next open pay period (EQ-04). */
export const PayAdjustmentIdSchema = uuid.brand<'PayAdjustmentId'>();
export type PayAdjustmentId = z.infer<typeof PayAdjustmentIdSchema>;

/** A decision of the validator on a sale held or wrongly given to a member (CRM-03, ADR 0050 § 5). */
export const PaySaleDecisionIdSchema = uuid.brand<'PaySaleDecisionId'>();
export type PaySaleDecisionId = z.infer<typeof PaySaleDecisionIdSchema>;

/** A chatter's signal that a sale on their statement is not theirs, or its withdrawal (CRM-03 lot b4c, ADR 0050 § 5). */
export const PaySaleSignalIdSchema = uuid.brand<'PaySaleSignalId'>();
export type PaySaleSignalId = z.infer<typeof PaySaleSignalIdSchema>;

/** What a validated statement carries to the next pay period instead of paying it (EQ-04). */
export const CarryOverIdSchema = uuid.brand<'CarryOverId'>();
export type CarryOverId = z.infer<typeof CarryOverIdSchema>;

/** The individual bonus tiers from a pay period on (EQ-04). */
export const BonusTierSetIdSchema = uuid.brand<'BonusTierSetId'>();
export type BonusTierSetId = z.infer<typeof BonusTierSetIdSchema>;

/** A payout minimum from a pay period on (PAIE-22). */
export const PayoutMinimumIdSchema = uuid.brand<'PayoutMinimumId'>();
export type PayoutMinimumId = z.infer<typeof PayoutMinimumIdSchema>;

/** The team's collective goal for a pay period, with its tiers (EQ-04). */
export const CollectiveGoalIdSchema = uuid.brand<'CollectiveGoalId'>();
export type CollectiveGoalId = z.infer<typeof CollectiveGoalIdSchema>;

/** A billing regime the owner sets and the accountant validates: VAT, withholding, mentions, documents (EQ-06). */
export const BillingRegimeIdSchema = uuid.brand<'BillingRegimeId'>();
export type BillingRegimeId = z.infer<typeof BillingRegimeIdSchema>;

/** A contractor's billing regime from a day on, never backwards (EQ-06). */
export const ContractorRegimeIdSchema = uuid.brand<'ContractorRegimeId'>();
export type ContractorRegimeId = z.infer<typeof ContractorRegimeIdSchema>;

/** A dated document a regime asks of a contractor: tax residence, URSSAF vigilance (EQ-06). */
export const ContractorDocumentIdSchema = uuid.brand<'ContractorDocumentId'>();
export type ContractorDocumentId = z.infer<typeof ContractorDocumentIdSchema>;

/** A version of the service contract or of the billing mandate, as the agency's accountant gave it (EQ-06). */
export const ContractTextIdSchema = uuid.brand<'ContractTextId'>();
export type ContractTextId = z.infer<typeof ContractTextIdSchema>;

/** A contractor's acceptance of one version of a contract text (EQ-06). */
export const ContractAcceptanceIdSchema = uuid.brand<'ContractAcceptanceId'>();
export type ContractAcceptanceId = z.infer<typeof ContractAcceptanceIdSchema>;

/** A self-billed invoice or a credit note, in its contractor's sequence (EQ-06). */
export const InvoiceIdSchema = uuid.brand<'InvoiceId'>();
export type InvoiceId = z.infer<typeof InvoiceIdSchema>;

/** A step in an invoice's life: issue, acceptance, contest, credit, payment (EQ-06). */
export const InvoiceEventIdSchema = uuid.brand<'InvoiceEventId'>();
export type InvoiceEventId = z.infer<typeof InvoiceEventIdSchema>;

/** A line of a platform's register as Impera keeps it (`platform_sales`, its quarantine; ADR 0050). */
export const SalesLineIdSchema = uuid.brand<'SalesLineId'>();
export type SalesLineId = z.infer<typeof SalesLineIdSchema>;

/** A reliability check's report as Impera keeps it (`sales_feed_checks`, CRM-02 and CRM-03). */
export const SalesFeedCheckIdSchema = uuid.brand<'SalesFeedCheckId'>();
export type SalesFeedCheckId = z.infer<typeof SalesFeedCheckIdSchema>;

/** A trend signal (`trend_signals`, ADR 0060 § 2). */
export const TrendSignalIdSchema = uuid.brand<'TrendSignalId'>();
export type TrendSignalId = z.infer<typeof TrendSignalIdSchema>;

/** A post the extension read while someone watched Instagram (`trend_readings`, ADR 0060 § 2, source 6). */
export const TrendReadingIdSchema = uuid.brand<'TrendReadingId'>();
export type TrendReadingId = z.infer<typeof TrendReadingIdSchema>;

/** A content idea (`content_ideas`, ADR 0060 § 4). */
export const ContentIdeaIdSchema = uuid.brand<'ContentIdeaId'>();
export type ContentIdeaId = z.infer<typeof ContentIdeaIdSchema>;

/** The link between one person's extension and the server (`extension_links`, VEI-01). */
export const ExtensionLinkIdSchema = uuid.brand<'ExtensionLinkId'>();
export type ExtensionLinkId = z.infer<typeof ExtensionLinkIdSchema>;

/** A watch session of the extension, drawn by the extension when someone turns « Veille » on (ADR 0060 § 2). */
export const WatchSessionIdSchema = uuid.brand<'WatchSessionId'>();
export type WatchSessionId = z.infer<typeof WatchSessionIdSchema>;

/** A task of her agenda (`creator_tasks`, CR-05): timed, of a day, or of her routine. */
export const CreatorTaskIdSchema = uuid.brand<'CreatorTaskId'>();
export type CreatorTaskId = z.infer<typeof CreatorTaskIdSchema>;

/** A dispo she opens to the agency (`creator_availabilities`, CR-05). */
export const AvailabilityIdSchema = uuid.brand<'AvailabilityId'>();
export type AvailabilityId = z.infer<typeof AvailabilityIdSchema>;

/** A suggestion of the agency or the AI for her agenda (`creator_suggestions`, CR-05, ADR 0042 § 3). */
export const SuggestionIdSchema = uuid.brand<'SuggestionId'>();
export type SuggestionId = z.infer<typeof SuggestionIdSchema>;

/** A drop of hers (`content_drops`, CR-06, ADR 0044 § 1 and ADR 0055): drawn by her phone, so that a replay adds nothing. */
export const ContentDropIdSchema = uuid.brand<'ContentDropId'>();
export type ContentDropId = z.infer<typeof ContentDropIdSchema>;

/** A sent script's synthesis (ADR 0083 § 6). */
export const ScriptDropSummaryIdSchema = uuid.brand<'ScriptDropSummaryId'>();
export type ScriptDropSummaryId = z.infer<typeof ScriptDropSummaryIdSchema>;

/** One file of a drop (`content_drop_files`), drawn by her phone with the drop. */
export const ContentDropFileIdSchema = uuid.brand<'ContentDropFileId'>();
export type ContentDropFileId = z.infer<typeof ContentDropFileIdSchema>;

/** What the agency asks of her (`content_requests`, ADR 0055 § 4). */
export const ContentRequestIdSchema = uuid.brand<'ContentRequestId'>();
export type ContentRequestId = z.infer<typeof ContentRequestIdSchema>;
