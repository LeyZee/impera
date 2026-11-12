/** LlmGateway: sense, brain, voice and judge roles over provider SDKs (ADR 0009). The only package that imports one. */
export const LLM_PACKAGE = '@impera/llm';

export {
  startOfLocalDay,
  UNBILLED_OUTCOMES,
  UNKNOWN_CALL_COST_USD,
  type BudgetEvent,
  type BudgetState,
  type BudgetStatus,
} from './budget';
export {
  CALL_OUTCOMES,
  createInMemoryCallLog,
  createJsonlCallLog,
  createPersistentCallLog,
  type CallOutcome,
  type LlmCallLog,
  type LlmCallRecord,
  type LlmCallStore,
  type PersistentCallLog,
  type PersistentCallLogOptions,
} from './call-log';
export {
  MODELS,
  PROVIDERS,
  TRANSCRIPTION_MODEL,
  acceptsInput,
  costUsd,
  findModel,
  type InputKind,
  type ModelInfo,
  type ProviderInfo,
} from './catalog';
export {
  DEFAULT_LLM_CONFIG,
  LlmConfigSchema,
  MISTRAL_FALLBACK_MODEL,
  readProviderCredentials,
  type ApiKeys,
  type ApiKeySource,
  type LlmConfig,
  type LlmRole,
  type LlmRoleConfig,
  type ModelRef,
  type ProviderCredentials,
  type ProviderId,
} from './config';
export {
  createLlmGateway,
  type BrainAlert,
  type BrainInput,
  type CallMeta,
  type ChannelPostInput,
  type ChannelPostResult,
  type ConnectionTest,
  type ConversationInput,
  type ConversationTurn,
  type DropContext,
  type DropSenseInput,
  type FanCardReadInput,
  type FanCardReadMessage,
  type LlmFailure,
  type LlmGateway,
  type ScriptSummaryInput,
  type ScriptSummaryMedia,
  type ScriptSummaryStep,
  type CallTrace,
  type KeyRefusal,
  type LlmGatewayDeps,
  type LlmSuccess,
  type SenseInput,
  type SenseMedia,
  type Transcript,
  type TrendCapturesInput,
  type TurnMedia,
  type VideoFrame,
  type VideoKeyframes,
  type JudgeInput,
  type VoiceInput,
} from './gateway';
export type { HealthReport, HealthState, ProviderHealth, RoleHealth } from './health';
export { loadPrompt } from './prompts';
export {
  createModelResolver,
  createTranscriberResolver,
  type ModelResolver,
  type ProviderBaseUrls,
} from './providers';
export {
  BRAIN_ALERTS_MAX,
  brainAlertId,
  BriefSchema,
  CHANNEL_POST_TEXT_MAX,
  JudgeCriterionSchema,
  VoiceOutputSchema,
  type Brief,
  type JudgeCriterion,
  type JudgeOutput,
  type VoiceOutput,
} from './schemas';
export { wrapUntrusted, type UntrustedKind } from './untrusted';
