import { z } from 'zod';

import type { ProviderVerifier, VerificationOutcome } from '../domain/verification';

import { getJson, isProviderTrouble, unreachableFrom, type FetchLike } from './http';

/** `GET /v1/api-key` describes the key itself: its name, its access lists, whether it is blocked. */
const ApiKeyInfoSchema = z.object({
  name: z.string().optional(),
  acls: z.array(z.string()).optional(),
  api_key_blocked: z.boolean().optional(),
  api_key_disabled: z.boolean().optional(),
  team_blocked: z.boolean().optional(),
});

export interface XaiVerifierOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  /** The model the Voice and the Brain run on (ADR 0009, packages/llm config). */
  readonly requiredModel?: string;
}

/** A key may carry model access lists (`api-key:model:<name>`); none at all means every model of the team. */
function canUseModel(acls: readonly string[], model: string): boolean {
  const modelAcls = acls.filter((acl) => acl.startsWith('api-key:model:'));
  return (
    modelAcls.length === 0 ||
    modelAcls.includes('api-key:model:*') ||
    modelAcls.includes(`api-key:model:${model}`)
  );
}

function mentionsCredit(body: unknown): boolean {
  return /credit|billing|spending/i.test(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createXaiVerifier(options: XaiVerifierOptions): ProviderVerifier {
  const baseUrl = options.baseUrl ?? 'https://api.x.ai';
  const model = options.requiredModel ?? 'grok-4.7';
  return {
    provider: 'xai',
    async verify(key): Promise<VerificationOutcome> {
      const reply = await getJson(options.fetch, `${baseUrl}/v1/api-key`, { authorization: `Bearer ${key}` });
      if (reply.kind === 'unreachable' || isProviderTrouble(reply.status)) return unreachableFrom(reply);
      if (reply.status === 400 || reply.status === 401) return { ok: false, kind: 'unauthorized' };
      if (reply.status === 403) {
        return { ok: false, kind: mentionsCredit(reply.body) ? 'no_credit' : 'unauthorized' };
      }
      const info = ApiKeyInfoSchema.safeParse(reply.body);
      if (reply.status !== 200 || !info.success) return unreachableFrom(reply);
      if (info.data.api_key_blocked === true || info.data.api_key_disabled === true) {
        return { ok: false, kind: 'unauthorized' };
      }
      if (info.data.team_blocked === true) return { ok: false, kind: 'no_credit' };
      if (!canUseModel(info.data.acls ?? [], model)) return { ok: false, kind: 'model_not_allowed' };
      const label = model === 'grok-4.7' ? 'Grok 4.7' : model;
      return {
        ok: true,
        keyLabel: info.data.name ?? null,
        summary: `${label} écrit et décide`,
        facts: [
          { label: 'Modèle', value: label },
          { label: 'Utilisé pour', value: 'La voix et les décisions' },
        ],
        settings: {},
        voices: [],
        charactersLeft: null,
        quota: null,
        isLowCredit: false,
      };
    },
  };
}
