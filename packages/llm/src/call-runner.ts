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
  /** No text at all and no content filter: a block for Gemini, a reasoning that ended without its answer for Grok. */
  readonly isEmpty?: boolean;
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

/**
 * What a provider says when the account has nothing left to spend: prepaid credits run out, the monthly limit reached,
 * or the usage included with a subscription used up (ADR 0091 § 6). Read in the answer's body, which is never kept: it
 * names the team.
 */
const QUOTA_REFUSAL =
  /insufficient[_ ]quota|resource has been exhausted|(?:spending|usage) limit (?:reached|exceeded)|reached its monthly spending limit|used all available credits|(?:no|out of|insufficient) credits?\b|(?:doesn't|does not) have any credits/iu;

/**
 * A 402, or a 403 or 429 whose body says the account is used up: not a bad key, not worth asking again. A 429 that
 * says when to come back (`retry-after`) is a rate limit, whatever its body.
 */
function isQuotaRefusal(
  status: number | undefined,
  body: string | undefined,
  headers: Record<string, string> | undefined,
): boolean {
  if (status === 402) return true;
  if (status === 429 && headers?.['retry-after'] !== undefined) return false;
  return (status === 403 || status === 429) && body !== undefined && QUOTA_REFUSAL.test(body);
}

export function classify(error: unknown): Classified {
  if (NoObjectGeneratedError.isInstance(error)) {
    // A block the SDK only reports as a failed object (see the finish check in `run`).
    const isEmpty = error.finishReason !== 'content-filter' && (error.text ?? '').trim() === '';
    const isBlocked =
      error.finishReason === 'content-filter' ||
      error.finishReason === 'other' ||
      (error.text ?? '').trim() === '';
    return {
      outcome: isBlocked ? 'refused' : 'invalid_output',
      isTransient: false,
      message: error.message,
      ...(isEmpty && { isEmpty }),
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
    if (isQuotaRefusal(status, error.responseBody, error.responseHeaders))
      return { outcome: 'quota_exhausted', isTransient: false, message: `HTTP ${String(status)} quota` };
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
  /** Waits before a hedged request (`hedgeAfterMs`); a real timer unless a test passes its own. */
  readonly hedgeTimer?: (ms: number) => Promise<void>;
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

/** What the runner does with one settled request, once it is journaled. */
type Step<T> =
  | { readonly kind: 'success'; readonly value: LlmSuccess<T> }
  /** Grok ended its reasoning with no answer: asked once more on the same model. */
  | { readonly kind: 'empty' }
  /** Refused or leaked its prompt: nothing more from this model. */
  | { readonly kind: 'stop' }
  | { readonly kind: 'failed'; readonly classified: Classified };

/**
 * One structured call for a role: main model then fallback, transient retries, one repair round on an
 * invalid output, refusals and prompt leaks moved to the next model, every attempt journaled.
 *
 * A role with `hedgeAfterMs` asks its main model a second time, in parallel, when the first request is still running after
 * that long, and keeps the first good answer: a slow request is the exception, and the second one usually lands before
 * it. A request past its delay is not asked again on the same model: the fallback answers.
 */
export function createCallRunner(deps: CallRunnerDeps): CallRunner {
  const { now, canary } = deps;
  const sleep = deps.sleep ?? realSleep;
  const hedgeTimer = deps.hedgeTimer ?? realSleep;
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

      /** One request to this model: its answer or what it threw, and how long it took; never throws. */
      const request = async (messages: ModelMessage[]) => {
        const startedAt = now().getTime();
        try {
          const answer = await generateText({
            model,
            system,
            messages,
            output: Output.object({ schema }),
            temperature: roleConfig.temperature,
            maxOutputTokens: roleConfig.maxOutputTokens,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(roleConfig.timeoutMs),
            ...(ref.provider === 'google' && { providerOptions: GOOGLE_SAFETY }),
            ...(ref.provider === 'xai' &&
              roleConfig.reasoningEffort !== undefined && {
                providerOptions: { xai: { reasoningEffort: roleConfig.reasoningEffort } },
              }),
          });
          return { latencyMs: now().getTime() - startedAt, answer };
        } catch (error) {
          return { latencyMs: now().getTime() - startedAt, error };
        }
      };
      type Settled = Awaited<ReturnType<typeof request>>;

      /** Journals a settled request and says what it gave. `mayRetryEmpty`: an empty answer may be asked again. */
      const judge = (settled: Settled, mayRetryEmpty: boolean): Step<T> => {
        const { latencyMs } = settled;
        try {
          if ('error' in settled) throw settled.error;
          const result = settled.answer;
          const cost = costUsd(ref, result.usage);
          // Gemini blocks a media by stopping with no text (finish « other ») as often as with « content-filter »:
          // both are a refusal, and asking again with the same media would only be refused again.
          const isBlocked =
            result.finishReason === 'content-filter' ||
            (result.finishReason === 'other' && result.text.trim() === '');
          if (isBlocked) {
            const isEmpty = result.finishReason !== 'content-filter' && result.text.trim() === '';
            if (isEmpty && mayRetryEmpty) {
              record('invalid_output', latencyMs, {
                errorMessage: 'empty answer',
                ...(cost !== undefined && { costUsd: cost }),
              });
              return { kind: 'empty' };
            }
            record('refused', latencyMs, cost === undefined ? {} : { costUsd: cost });
            return { kind: 'stop' };
          }
          const output = result.output;
          if (JSON.stringify(output).includes(canary)) {
            // The fan got the model to write its instructions: nothing of this output may go further.
            record('prompt_leak', latencyMs, cost === undefined ? {} : { costUsd: cost });
            return { kind: 'stop' };
          }
          record('ok', latencyMs, {
            ...(result.usage.inputTokens !== undefined && { inputTokens: result.usage.inputTokens }),
            ...(result.usage.inputTokenDetails.cacheReadTokens !== undefined && {
              cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
            }),
            ...(result.usage.outputTokens !== undefined && { outputTokens: result.usage.outputTokens }),
            ...(cost !== undefined && { costUsd: cost }),
          });
          return {
            kind: 'success',
            value: {
              output,
              meta: {
                provider: ref.provider,
                model: ref.model,
                isFallback,
                latencyMs,
                promptHash: prompt.hash,
                ...(cost !== undefined && { costUsd: cost }),
              },
            },
          };
        } catch (error) {
          const classified = classify(error);
          const { outcome, message, usage, refusedStatus, isEmpty } = classified;
          if (refusedStatus !== undefined) deps.reportRefusal(ref.provider, refusedStatus);
          const cost = usage === undefined ? undefined : costUsd(ref, usage);
          if (isEmpty === true && mayRetryEmpty) {
            record('invalid_output', latencyMs, {
              errorMessage: 'empty answer',
              ...(cost !== undefined && { costUsd: cost }),
            });
            return { kind: 'empty' };
          }
          record(outcome, latencyMs, {
            errorMessage: message.slice(0, 200),
            ...(cost !== undefined && { costUsd: cost }),
          });
          return { kind: 'failed', classified };
        }
      };

      /**
       * One attempt, hedged when the role says so: past `hedgeAfterMs`, a second identical request runs beside the
       * first and the first good answer wins. The other one is left to finish and is journaled with its real cost, so
       * the daily cap and the AI spend count it; aborted, it would be billed all the same and counted blind.
       */
      const attempt = async (messages: ModelMessage[], mayRetryEmpty: boolean): Promise<Step<T>> => {
        const first = request(messages);
        // Only the main model: the fallback is there because it was slow, and Charles agreed the extra cost for Grok.
        const hedgeAfterMs = isFallback ? undefined : roleConfig.hedgeAfterMs;
        if (hedgeAfterMs === undefined) return judge(await first, mayRetryEmpty);
        const early = await Promise.race([first, hedgeTimer(hedgeAfterMs).then(() => undefined)]);
        if (early !== undefined) return judge(early, mayRetryEmpty);
        // The second request is a call like any other: the cap may refuse it.
        if (deps.overBudget(trace.purpose) !== undefined) return judge(await first, mayRetryEmpty);
        const second = request(messages);
        const winner = await Promise.race([
          first.then((settled) => ({ settled, other: second })),
          second.then((settled) => ({ settled, other: first })),
        ]);
        const step = judge(winner.settled, mayRetryEmpty);
        if (step.kind !== 'success') return judge(await winner.other, mayRetryEmpty);
        void winner.other.then((settled) => {
          judge(settled, false);
        });
        return step;
      };

      let messages = built;
      let transientLeft = deps.config.maxTransientRetries;
      let hasRepaired = false;
      // Grok sometimes ends its reasoning with no answer at all (11/11, about one judge call in four on a scenario):
      // asked once more on the same model. Never Gemini, whose empty answer is a block of the media (see below).
      let hasRetriedEmpty = ref.provider === 'google';
      for (;;) {
        const step = await attempt(messages, !hasRetriedEmpty);
        if (step.kind === 'success') return ok(step.value);
        if (step.kind === 'empty') {
          hasRetriedEmpty = true;
          continue;
        }
        if (step.kind === 'stop') break;
        const { outcome, isTransient, message, retryAfterMs: asked } = step.classified;
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
        // Past its delay, the model is slow right now: asked again, it would cost another full delay before the
        // fallback (two minutes per call on 12/11). The fallback answers at once.
        if (outcome === 'timeout') break;
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
    return err({ code: 'all_models_failed', attempts });
  };
}
