import { z } from 'zod';

import type { ProviderVerifier, VerificationOutcome } from '../domain/verification';

import { getJson, isProviderTrouble, unreachableFrom, type FetchLike } from './http';

/**
 * `GET /v1/models` lists what the key can call. The writing fallback is pinned to this model (packages/llm,
 * `MISTRAL_FALLBACK_MODEL`; `llm.test.ts` keeps the two equal): a key that sees another Mistral Large only would be
 * accepted here and refused at the first relay.
 */
export const MISTRAL_WRITING_FALLBACK = 'mistral-large-4';
const ModelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export interface MistralVerifierOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
}

export function createMistralVerifier(options: MistralVerifierOptions): ProviderVerifier {
  const baseUrl = options.baseUrl ?? 'https://api.mistral.ai';
  return {
    provider: 'mistral',
    async verify(key): Promise<VerificationOutcome> {
      const reply = await getJson(options.fetch, `${baseUrl}/v1/models`, { authorization: `Bearer ${key}` });
      if (reply.kind === 'unreachable' || isProviderTrouble(reply.status)) return unreachableFrom(reply);
      if (reply.status === 401 || reply.status === 403) return { ok: false, kind: 'unauthorized' };
      if (reply.status === 402) return { ok: false, kind: 'no_credit' };
      const models = ModelsSchema.safeParse(reply.body);
      if (reply.status !== 200 || !models.success) return unreachableFrom(reply);
      if (!models.data.data.some((model) => model.id === MISTRAL_WRITING_FALLBACK))
        return { ok: false, kind: 'model_not_allowed' };
      return {
        ok: true,
        keyLabel: null,
        summary: 'Mistral Large prend le relais si Grok ne répond plus',
        facts: [
          { label: 'Modèle', value: 'Mistral Large' },
          { label: 'Utilisé pour', value: 'Le relais de la voix et des décisions' },
        ],
        settings: {},
        voices: [],
        charactersLeft: null,
        isLowCredit: false,
      };
    },
  };
}
