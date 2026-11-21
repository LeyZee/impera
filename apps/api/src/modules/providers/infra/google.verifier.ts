import { z } from 'zod';

import type { ProviderVerifier, VerificationOutcome } from '../domain/verification';

import { getJson, isProviderTrouble, unreachableFrom, type FetchLike } from './http';

const ModelsSchema = z.object({
  models: z.array(z.object({ name: z.string(), displayName: z.string().optional() })).default([]),
});

export interface GoogleVerifierOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  /** The Vision model chosen by Charles (17/10 18h20); its exact identifier is resolved here, with the key. */
  readonly visionModel?: string;
  /** Shown as « Aussi visible » when the key sees it, for the comparison on ~20 catalogue videos. */
  readonly compareWith?: string;
}

interface GoogleModel {
  readonly id: string;
  readonly label: string;
}

/** Exact identifier first, else the first dated or preview variant of it (`gemini-3.8-flash-preview-…`). */
function resolve(models: readonly GoogleModel[], wanted: string): GoogleModel | undefined {
  return (
    models.find((m) => m.id === wanted) ??
    [...models].sort((a, b) => a.id.localeCompare(b.id)).find((m) => m.id.startsWith(`${wanted}-`))
  );
}

function isRefusedKey(body: unknown): boolean {
  return /API_KEY_INVALID|API key not valid/i.test(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createGoogleVerifier(options: GoogleVerifierOptions): ProviderVerifier {
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com';
  return {
    provider: 'google',
    async verify(key, settings): Promise<VerificationOutcome> {
      const reply = await getJson(options.fetch, `${baseUrl}/v1beta/models?pageSize=1000`, {
        'x-goog-api-key': key,
      });
      if (reply.kind === 'unreachable' || isProviderTrouble(reply.status)) return unreachableFrom(reply);
      if (reply.status === 401 || (reply.status === 400 && isRefusedKey(reply.body))) {
        return { ok: false, kind: 'unauthorized' };
      }
      if (reply.status === 403) return { ok: false, kind: 'api_not_enabled' };
      const parsed = ModelsSchema.safeParse(reply.body);
      if (reply.status !== 200 || !parsed.success) return unreachableFrom(reply);

      const models = parsed.data.models.map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, label: m.displayName ?? id };
      });
      const wanted = settings.visionModel ?? options.visionModel ?? 'gemini-3.8-flash';
      const vision = resolve(models, wanted);
      if (vision === undefined) {
        const gemini = models.filter((m) => m.id.startsWith('gemini-')).map((m) => m.id);
        return { ok: false, kind: 'vision_model_missing', availableModels: gemini.slice(0, 6) };
      }
      const compare = options.compareWith === undefined ? undefined : resolve(models, options.compareWith);
      return {
        ok: true,
        keyLabel: null,
        summary: `${vision.label} regarde les médias`,
        facts: [
          { label: 'Modèle', value: vision.label },
          ...(compare === undefined
            ? []
            : [{ label: 'Aussi visible', value: `${compare.label}, pour comparer` }]),
          { label: 'Si Gemini refuse un média', value: 'Grok prend le relais' },
        ],
        settings: { visionModel: vision.id },
        voices: [],
        charactersLeft: null,
        quota: null,
        isLowCredit: false,
      };
    },
  };
}
