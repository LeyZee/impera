/** LlmGateway: sense, brain, voice and judge roles over provider SDKs (ADR 0009). The only package that imports one. */
export const LLM_PACKAGE = '@nirvana/llm';

export { startOfLocalDay, type BudgetEvent, type BudgetState, type BudgetStatus } from './budget';
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
  type ConnectionTest,
  type ConversationInput,
  type ConversationTurn,
  type LlmFailure,
  type LlmGateway,
  type CallTrace,
  type KeyRefusal,
  type LlmGatewayDeps,
  type LlmSuccess,
  type SenseInput,
  type SenseMedia,
  type Transcript,
  type TurnMedia,
  type VideoFrame,
  type VideoKeyframes,
  type JudgeInput,
  type VoiceInput,
} from './gateway';
export type { HealthReport, HealthState, ProviderHealth, RoleHealth } from './health';
export { loadPrompt } from './prompts';
export { createModelResolver, createTranscriberResolver, type ModelResolver } from './providers';
export {
  BRAIN_ALERTS_MAX,
  brainAlertId,
  BriefSchema,
  JudgeCriterionSchema,
  VoiceOutputSchema,
  type Brief,
  type JudgeCriterion,
  type JudgeOutput,
  type VoiceOutput,
} from './schemas';
export { wrapUntrusted, type UntrustedKind } from './untrusted';
