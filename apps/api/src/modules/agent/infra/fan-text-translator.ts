import type { Language } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import {
  TRANSLATION_MAX_COST_USD,
  TRANSLATION_MAX_INPUT_CHARS,
  TRANSLATION_TIMEOUT_MS,
  checkTranslation,
  needsTranslation,
  type FanTextTranslation,
  type FanTextTranslator,
  type TranslationRead,
} from '../domain/guard-translation';

/** The ceilings of one translation, the domain's unless a test gives its own. */
export interface TranslationLimits {
  readonly timeoutMs: number;
  readonly maxCostUsd: number;
}

const LIMITS: TranslationLimits = {
  timeoutMs: TRANSLATION_TIMEOUT_MS,
  maxCostUsd: TRANSLATION_MAX_COST_USD,
};

/**
 * The `FanTextTranslator` port on the gateway (ADR 0168 § 5, amended 27/11): his original text, at most
 * `TRANSLATION_MAX_INPUT_CHARS`, into French by the cheap role, journaled in `llm_calls` like any call (cost, tokens,
 * never a text). Past its own time or cost ceiling, or with no known cost, the answer is not used. Never throws.
 */
export function createFanTextTranslator(
  gateway: Pick<LlmGateway, 'translateFanText'>,
  limits: TranslationLimits = LIMITS,
): FanTextTranslator {
  return {
    async toFrench(text, trace): Promise<FanTextTranslation> {
      if (text.length > TRANSLATION_MAX_INPUT_CHARS) return { ok: false, reason: 'too_long' };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          resolve('timeout');
        }, limits.timeoutMs);
      });
      try {
        const answer = await Promise.race([gateway.translateFanText({ text, trace }), late]);
        if (answer === 'timeout') return { ok: false, reason: 'timeout' };
        if (!answer.ok) return { ok: false, reason: 'failed' };
        const cost = answer.value.meta.costUsd;
        if (cost === undefined || cost > limits.maxCostUsd) return { ok: false, reason: 'too_costly' };
        return { ok: true, french: answer.value.output.french };
      } catch {
        return { ok: false, reason: 'failed' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * His message read for the nets: translated when the setting is on and his language is one the nets do not read,
 * then checked (`checkTranslation`). Off, not needed, or no translator: nothing is asked and `humanOnly` stays.
 */
export async function translationForNets(
  translator: FanTextTranslator | undefined,
  input: {
    readonly on: boolean;
    readonly fanText: string;
    readonly kept: Language | null;
    readonly trace: Parameters<FanTextTranslator['toFrench']>[1];
  },
): Promise<TranslationRead> {
  if (translator === undefined || !needsTranslation(input)) return { kind: 'not_asked' };
  const answer = await translator.toFrench(input.fanText, input.trace);
  if (!answer.ok) return { kind: 'failed', reason: answer.reason };
  return { kind: 'translated', french: answer.french, check: checkTranslation(input.fanText, answer.french) };
}
