import { err, ok, type LlmPurpose, type Result } from '@impera/contracts';
import {
  APICallError,
  generateText,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import type { z } from 'zod';

import type { CallOutcome, LlmCallLog } from './call-log';
import { costUsd } from './catalog';
import type { LlmConfig, LlmRole, ModelRef, ProviderId } from './config';
import type { CallTrace, LlmFailure, LlmSuccess } from './gateway-types';
import type { PromptTemplate } from './prompts';
import type { ModelResolver } from './providers';

interface Classified {
  readonly outcome: CallOutcome;
  readonly isTransient: boolean;
  readonly message: string;
  /** Tokens the failed call still billed, when the provider said. */
  readonly usage?: LanguageModelUsage;
  /** The provider turned the key down: the CRM marks the service « à reconnecter » (ADR 0016). */
  readonly refusedStatus?: 401 | 403;
  /** How long the provider asked to wait (`retry-after`), when it said. */
  readonly retryAfterMs?: number;
}

/** `retry-after` in seconds or as an HTTP date. */
function retryAfterMs(headers: Record<string, string> | undefined, now: number): number | undefined {
  const value = headers?.['retry-after']?.trim();
  if (value === undefined || value === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export function classify(error: unknown): Classified {
  if (NoObjectGeneratedError.isInstance(error)) {
    // A block the SDK only reports as a failed object (see the finish check in `run`).
    const isBlocked =
      error.finishReason === 'content-filter' ||
      error.finishReason === 'other' ||
      (error.text ?? '').trim() === '';
    return {
      outcome: isBlocked ? 'refused' : 'invalid_output',
      isTransient: false,
      message: error.message,
      ...(error.usage !== undefined && { usage: error.usage }),
    };
  }
  if (NoOutputGeneratedError.isInstance(error)) {
    return { outcome: 'invalid_output', isTransient: false, message: error.message };
  }
  if (TypeValidationError.isInstance(error) || JSONParseError.isInstance(error)) {
    return { outcome: 'invalid_output', isTransient: false, message: error.message };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403)
      return {
        outcome: 'auth',
        isTransient: false,
        message: `HTTP ${String(status)}`,
        refusedStatus: status,
      };
    if (status === 429) {
      const wait = retryAfterMs(error.responseHeaders, Date.now());
      return {
        outcome: 'rate_limited',
        isTransient: true,
        message: 'HTTP 429',
        ...(wait !== undefined && { retryAfterMs: wait }),
      };
    }
    if (status !== undefined && status >= 500) {
      const wait = retryAfterMs(error.responseHeaders, Date.now());
      return {
        outcome: 'unavailable',
        isTransient: true,
        message: `HTTP ${String(status)}`,
        ...(wait !== undefined && { retryAfterMs: wait }),
      };
    }
    return { outcome: 'error', isTransient: error.isRetryable, message: `HTTP ${String(status ?? '?')}` };
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { outcome: 'timeout', isTransient: true, message: 'timeout' };
  }
  return {
    outcome: 'error',
    isTransient: false,
    message: error instanceof Error ? error.name : 'unknown error',
  };
}

/** Gemini's own filters, off for sexual content between adults (Charles, 17/10); core harms stay blocked. */
const GOOGLE_SAFETY = {
  google: {
    safetySettings: (
      [
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ] as const
    ).map((category) => ({ category, threshold: 'OFF' })),
  },
};

export interface CallRunnerDeps {
  readonly config: LlmConfig;
  readonly log: LlmCallLog;
  readonly resolveModel: ModelResolver;
  readonly now: () => Date;
  readonly canary: string;
  readonly reportRefusal: (provider: ProviderId, status: 401 | 403) => void;
  /**
   * The cap that refuses a call for this purpose, once today's spend reaches it: no model is called at all.
   * `undefined` while it may go on.
   */
  readonly overBudget: (purpose: LlmPurpose | undefined) => LlmFailure['code'] | undefined;
  /** Waits before a transient retry; a real timer unless a test passes its own. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Waits before the n-th transient retry: 0.5 s, 1 s, 2 s, at most 4 s. */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 4_000;
/** A provider asking for more than this is better left for the fallback model. */
const RETRY_AFTER_MAX_MS = 10_000;

function retryDelayMs(retry: number, retryAfter: number | undefined): number | undefined {
  if (retryAfter !== undefined) return retryAfter > RETRY_AFTER_MAX_MS ? undefined : retryAfter;
  return Math.min(BACKOFF_BASE_MS * 2 ** retry, BACKOFF_MAX_MS);
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type CallRunner = <T>(
  role: LlmRole,
  prompt: PromptTemplate,
  system: string,
  buildMessages: (ref: ModelRef) => Promise<ModelMessage[] | undefined>,
  schema: z.ZodType<T>,
  trace?: CallTrace,
) => Promise<Result<LlmSuccess<T>, LlmFailure>>;

/**
 * One structured call for a role: main model then fallback, transient retries, one repair round on an
 * invalid output, refusals and prompt leaks moved to the next model, every attempt journaled.
 */
export function createCallRunner(deps: CallRunnerDeps): CallRunner {
  const { now, canary } = deps;
  const sleep = deps.sleep ?? realSleep;
  return async function run<T>(
    role: LlmRole,
    prompt: PromptTemplate,
    system: string,
    buildMessages: (ref: ModelRef) => Promise<ModelMessage[] | undefined>,
    schema: z.ZodType<T>,
    trace: CallTrace = {},
  ): Promise<Result<LlmSuccess<T>, LlmFailure>> {
    const roleConfig = deps.config.roles[role];
    const targets: { ref: ModelRef; isFallback: boolean }[] = [{ ref: roleConfig, isFallback: false }];
    if (roleConfig.fallback !== undefined) targets.push({ ref: roleConfig.fallback, isFallback: true });
    const attempts: LlmFailure['attempts'][number][] = [];

    for (const { ref, isFallback } of targets) {
      // Checked before each model: a costly failure can spend the last euros before the fallback.
      const refusedBy = deps.overBudget(trace.purpose);
      if (refusedBy !== undefined) return err({ code: refusedBy, attempts });
      const record = (outcome: CallOutcome, latencyMs: number, extra: object = {}): void => {
        attempts.push({ provider: ref.provider, model: ref.model, outcome });
        deps.log.append({
          at: now(),
          role,
          provider: ref.provider,
          model: ref.model,
          promptHash: prompt.hash,
          outcome,
          latencyMs,
          isFallback,
          ...trace,
          ...extra,
        });
      };
      const model = deps.resolveModel(ref);
      if (model === undefined) {
        // Not a call: kept in the failure trace, out of the journal, so health shows the real last error.
        attempts.push({ provider: ref.provider, model: ref.model, outcome: 'missing_key' });
        continue;
      }
      let built: ModelMessage[] | undefined;
      try {
        built = await buildMessages(ref);
      } catch {
        // Keyframes could not be made: this model cannot be given the media.
        built = undefined;
      }
      if (built === undefined) {
        attempts.push({ provider: ref.provider, model: ref.model, outcome: 'unsupported_input' });
        continue;
      }
      let messages = built;
      let transientLeft = deps.config.maxTransientRetries;
      let hasRepaired = false;
      for (;;) {
        const startedAt = now().getTime();
        try {
          const result = await generateText({
            model,
            system,
            messages,
            output: Output.object({ schema }),
            temperature: roleConfig.temperature,
            maxOutputTokens: roleConfig.maxOutputTokens,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(roleConfig.timeoutMs),
            ...(ref.provider === 'google' && { providerOptions: GOOGLE_SAFETY }),
          });
          const latencyMs = now().getTime() - startedAt;
          const cost = costUsd(ref, result.usage);
          // Gemini blocks a media by stopping with no text (finish « other ») as often as with « content-filter »:
          // both are a refusal, and asking again with the same media would only be refused again.
          const isBlocked =
            result.finishReason === 'content-filter' ||
            (result.finishReason === 'other' && result.text.trim() === '');
          if (isBlocked) {
            record('refused', latencyMs, cost === undefined ? {} : { costUsd: cost });
            break;
          }
          if (JSON.stringify(result.output).includes(canary)) {
            // The fan got the model to write its instructions: nothing of this output may go further.
            record('prompt_leak', latencyMs, cost === undefined ? {} : { costUsd: cost });
            break;
          }
          record('ok', latencyMs, {
            ...(result.usage.inputTokens !== undefined && { inputTokens: result.usage.inputTokens }),
            ...(result.usage.inputTokenDetails.cacheReadTokens !== undefined && {
              cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
            }),
            ...(result.usage.outputTokens !== undefined && { outputTokens: result.usage.outputTokens }),
            ...(cost !== undefined && { costUsd: cost }),
          });
          return ok({
            output: result.output,
            meta: {
              provider: ref.provider,
              model: ref.model,
              isFallback,
              latencyMs,
              promptHash: prompt.hash,
              ...(cost !== undefined && { costUsd: cost }),
            },
          });
        } catch (error) {
          const latencyMs = now().getTime() - startedAt;
          const {
            outcome,
            isTransient,
            message,
            usage,
            refusedStatus,
            retryAfterMs: asked,
          } = classify(error);
          if (refusedStatus !== undefined) deps.reportRefusal(ref.provider, refusedStatus);
          const cost = usage === undefined ? undefined : costUsd(ref, usage);
          record(outcome, latencyMs, {
            errorMessage: message.slice(0, 200),
            ...(cost !== undefined && { costUsd: cost }),
          });
          if (outcome === 'invalid_output' && !hasRepaired) {
            hasRepaired = true;
            messages = [
              ...messages,
              {
                role: 'user',
                content: `Ta réponse précédente ne respectait pas le format demandé (${message.slice(0, 300)}). Réponds de nouveau, uniquement avec l'objet JSON.`,
              },
            ];
            continue;
          }
          if (isTransient && transientLeft > 0) {
            // A 429 or a 5xx asked again at once is refused again: wait, longer each time, or as the provider says.
            const delay = retryDelayMs(deps.config.maxTransientRetries - transientLeft, asked);
            if (delay === undefined) break;
            transientLeft -= 1;
            const stopped = deps.overBudget(trace.purpose);
            if (stopped !== undefined) return err({ code: stopped, attempts });
            await sleep(delay);
            continue;
          }
          break;
        }
      }
    }
    return err({ code: 'all_models_failed', attempts });
  };
}
