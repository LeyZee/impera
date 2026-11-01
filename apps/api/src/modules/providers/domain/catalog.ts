import type { AiProvider } from '@nirvana/contracts';

/** What the dashboard says about each service, in the order Charles reads them (fiche P3-03). */
export interface ProviderProfile {
  readonly provider: AiProvider;
  /** The service as Charles names it: Grok, Gemini, ElevenLabs. */
  readonly service: string;
  /** The company that issues the key, as its console names itself. */
  readonly vendor: string;
  readonly role: string;
  /** Shown on the line while the service is not connected. */
  readonly withoutIt: string;
  /** Shown when the provider refuses a key that used to work. */
  readonly revoked: string;
  /** What happens while the key is refused, after the reason (« Pas de vocaux pour l’instant. »). */
  readonly whileRefused: string;
  /** Keys start with this; used to spot a key pasted in the wrong place. */
  readonly keyPrefix: string | null;
  /** Without it the agent cannot write at all. */
  readonly isRequired: boolean;
}

export const PROVIDER_PROFILES: readonly ProviderProfile[] = [
  {
    provider: 'xai',
    service: 'Grok',
    vendor: 'xAI',
    role: 'Écrit les messages et décide',
    withoutIt: 'Sans lui, l’agent n’écrit qu’avec le relais Mistral, s’il est branché',
    revoked: 'xAI refuse la clé. Seul Mistral, s’il est branché, écrit en attendant.',
    whileRefused: 'Seul Mistral, s’il est branché, écrit en attendant.',
    keyPrefix: 'xai-',
    isRequired: true,
  },
  {
    provider: 'google',
    service: 'Gemini',
    vendor: 'Google',
    role: 'Regarde les photos et vidéos',
    withoutIt: 'Sans lui, Grok regarde les images, plus lentement',
    revoked: 'Google refuse la clé. Grok regarde les médias en attendant.',
    whileRefused: 'Grok regarde les médias en attendant.',
    keyPrefix: 'AIza',
    isRequired: false,
  },
  {
    provider: 'elevenlabs',
    service: 'ElevenLabs',
    vendor: 'ElevenLabs',
    role: 'Parle avec la voix de la créatrice',
    withoutIt: 'Optionnel. Sans lui, pas de vocaux',
    revoked: 'ElevenLabs refuse la clé. Pas de vocaux pour l’instant.',
    whileRefused: 'Pas de vocaux pour l’instant.',
    keyPrefix: 'sk_',
    isRequired: false,
  },
  {
    provider: 'mistral',
    service: 'Mistral',
    vendor: 'Mistral',
    role: 'Prend le relais si Grok ne répond plus',
    withoutIt: 'Recommandé. Sans lui, si Grok tombe, l’agent ne répond plus',
    revoked: 'Mistral refuse la clé. Plus de relais si Grok tombe.',
    whileRefused: 'Plus de relais si Grok tombe.',
    keyPrefix: null,
    isRequired: false,
  },
  {
    provider: 'venice',
    service: 'Venice',
    vendor: 'Venice',
    role: 'Second repli pour l’écriture',
    withoutIt: 'Optionnel. Second repli pour l’écriture',
    revoked: 'Venice refuse la clé. Second repli indisponible.',
    whileRefused: 'Second repli indisponible.',
    keyPrefix: null,
    isRequired: false,
  },
];

/**
 * The services the Services section shows, in reading order. Mistral is the writing fallback (packages/llm config);
 * Venice joins when a role uses it.
 */
export const DASHBOARD_PROVIDERS: readonly AiProvider[] = ['xai', 'google', 'mistral', 'elevenlabs'];

export function profileOf(provider: AiProvider): ProviderProfile {
  const profile = PROVIDER_PROFILES.find((p) => p.provider === provider);
  if (profile === undefined) throw new Error(`no profile for provider ${provider}`);
  return profile;
}
