import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel, TranscriptionModel } from 'ai';

import { TRANSCRIPTION_MODEL } from './catalog';
import { apiKeyFor, type ApiKeys, type ModelRef, type ProviderId } from './config';

/** Returns the model, or undefined when its provider has no API key configured. */
export type ModelResolver = (ref: ModelRef) => LanguageModel | undefined;

const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

/**
 * Where each provider's API is reached, as its SDK takes it (`…/v1`, `…/v1beta` for Google); the provider's own when
 * absent. The recette sandbox aims them at its local fake world (ADR 0075).
 */
export type ProviderBaseUrls = Partial<Record<ProviderId, string>>;

const at = (baseURL: string | undefined): { baseURL?: string } => (baseURL === undefined ? {} : { baseURL });

export function createModelResolver(credentials: ApiKeys, baseUrls: ProviderBaseUrls = {}): ModelResolver {
  return (ref) => {
    const apiKey = apiKeyFor(credentials, ref.provider);
    if (apiKey === undefined) return undefined;
    switch (ref.provider) {
      case 'xai':
        return createXai({ apiKey, ...at(baseUrls.xai) })(ref.model);
      case 'mistral':
        return createMistral({ apiKey, ...at(baseUrls.mistral) })(ref.model);
      case 'venice':
        return createOpenAICompatible({
          name: 'venice',
          baseURL: baseUrls.venice ?? VENICE_BASE_URL,
          apiKey,
        })(ref.model);
      case 'google':
        return createGoogleGenerativeAI({ apiKey, ...at(baseUrls.google) })(ref.model);
    }
  };
}

/** xAI speech to text, or undefined without an xAI key. */
export function createTranscriberResolver(
  credentials: ApiKeys,
  baseUrls: ProviderBaseUrls = {},
): () => TranscriptionModel | undefined {
  return () => {
    const apiKey = apiKeyFor(credentials, 'xai');
    return apiKey === undefined
      ? undefined
      : createXai({ apiKey, ...at(baseUrls.xai) }).transcription(TRANSCRIPTION_MODEL.model);
  };
}
