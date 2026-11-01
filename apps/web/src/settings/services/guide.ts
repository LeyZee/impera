import type { AiProvider } from '@nirvana/contracts';

/**
 * What the sheet teaches for each service: where to create the key and with which settings. The state of a service,
 * its facts and every refusal come from the API (`domain/messages.ts`), so they read the same everywhere.
 */

export type DashboardProvider = Extract<AiProvider, 'xai' | 'google' | 'mistral' | 'elevenlabs'>;

interface GuideTick {
  readonly label: string;
  /** Shown as text; `copy` adds a copy button, `code` sets it in mono. */
  readonly value: string;
  readonly copy?: boolean;
  readonly code?: boolean;
}

export interface ServiceGuide {
  readonly name: string;
  readonly brand: string;
  readonly vendor: string;
  /** What the service does, in a word or two: the small label next to its name in the list. */
  readonly tag: string;
  readonly role: string;
  /** Without it the agent stops: no « Plus tard ». */
  readonly isRequired: boolean;
  readonly console: { readonly label: string; readonly url: string };
  readonly where: string;
  readonly ticks: readonly GuideTick[];
  readonly note: string | null;
  /** What stops if the key is removed, said in the confirmation. */
  readonly offConsequence: string;
  readonly topUpUrl: string | null;
}

export const GUIDES: Record<DashboardProvider, ServiceGuide> = {
  xai: {
    name: 'Grok',
    brand: 'xAI',
    vendor: 'xAI',
    tag: 'Écrit',
    role: 'Écrit les messages et décide',
    isRequired: true,
    console: { label: 'Ouvrir la console xAI', url: 'https://console.x.ai' },
    where: 'Dans API Keys, crée une clé avec :',
    ticks: [
      { label: 'Nom', value: 'nirvana-prod', copy: true },
      { label: 'Modèles', value: 'grok-4.7 et grok-4.3', code: true },
      { label: 'Accès', value: 'Chat' },
    ],
    note: 'Le compte xAI doit avoir du crédit.',
    offConsequence: 'Seul Mistral, s’il est branché, écrira tant que Grok n’est pas reconnecté.',
    topUpUrl: 'https://console.x.ai',
  },
  google: {
    name: 'Gemini',
    brand: 'Google',
    vendor: 'Google',
    tag: 'Regarde les médias',
    role: 'Regarde les photos et vidéos',
    isRequired: false,
    console: { label: 'Ouvrir Google AI Studio', url: 'https://aistudio.google.com/apikey' },
    where: 'Clique sur Create API key, puis :',
    ticks: [
      { label: 'Projet', value: 'Nirvana', code: true },
      { label: 'Restriction', value: 'Restrict to Gemini API only' },
    ],
    note: 'Active la facturation du projet. En offre gratuite, Google peut garder les médias des fans.',
    offConsequence: 'Grok regardera lui-même les photos et vidéos des fans, plus lentement.',
    topUpUrl: 'https://aistudio.google.com',
  },
  mistral: {
    name: 'Mistral',
    brand: 'Relais',
    vendor: 'Mistral',
    tag: 'Relais',
    role: 'Prend le relais si Grok ne répond plus',
    isRequired: false,
    console: { label: 'Ouvrir la console Mistral', url: 'https://console.mistral.ai/api-keys' },
    where: 'Dans API Keys, clique sur Create new key, puis :',
    ticks: [
      { label: 'Nom', value: 'nirvana-prod', copy: true },
      { label: 'Expiration', value: 'Aucune' },
    ],
    note: 'Active la facturation du workspace : l’offre gratuite limite fortement le nombre d’appels.',
    offConsequence: 'Si Grok ne répond plus, l’agent n’aura plus de relais pour écrire.',
    topUpUrl: 'https://console.mistral.ai/billing',
  },
  elevenlabs: {
    name: 'ElevenLabs',
    brand: 'Vocaux',
    vendor: 'ElevenLabs',
    tag: 'Vocaux',
    role: 'Parle avec la voix de la créatrice',
    isRequired: false,
    console: { label: 'Ouvrir ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys' },
    where: 'Crée une clé avec :',
    ticks: [
      { label: 'Nom', value: 'nirvana-prod', copy: true },
      { label: 'Accès', value: 'Text to Speech, Voices et User en lecture' },
      { label: 'Limite', value: '100 000 caractères par mois', code: true },
    ],
    note: null,
    offConsequence: 'L’agent ne proposera plus de vocaux.',
    topUpUrl: 'https://elevenlabs.io/app/subscription',
  },
};

export function isDashboardProvider(provider: AiProvider): provider is DashboardProvider {
  return provider in GUIDES;
}
