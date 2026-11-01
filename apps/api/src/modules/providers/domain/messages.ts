import type { AiProvider, ProviderErrorKind, ProviderFact, ProviderVoice } from '@nirvana/contracts';

import { profileOf } from './catalog';
import type { UnreachableReason } from './verification';

/**
 * The single translation table (fiche P3-03, § Quand ça ne marche pas): the sheet, the Services line, the Dashboard
 * banner and the log all show the same sentence for the same problem. No HTTP code ever reaches the screen.
 */
export interface RefusalDetails {
  readonly belongsTo?: AiProvider;
  readonly availableModels?: readonly string[];
  readonly permission?: string;
  readonly visionModel?: string;
  readonly reason?: UnreachableReason;
}

const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  voices_read: 'Voices en lecture',
  user_read: 'User en lecture',
  text_to_speech: 'Text to Speech',
};

/** « de » before a company name, elided before a vowel: « d’ElevenLabs », « de Google ». */
function fromVendor(vendor: string): string {
  return /^[aeiouyàâéèêëîïôöùûü]/i.test(vendor) ? `d’${vendor}` : `de ${vendor}`;
}

export function describeRefusal(
  provider: AiProvider,
  kind: ProviderErrorKind,
  details: RefusalDetails = {},
): string {
  const { vendor } = profileOf(provider);
  switch (kind) {
    case 'too_short':
      return `Cette clé paraît incomplète. Copie-la en entier depuis ${vendor}.`;
    case 'wrong_provider': {
      const owner = details.belongsTo === undefined ? undefined : profileOf(details.belongsTo);
      return owner === undefined
        ? `Cette clé ne vient pas ${fromVendor(vendor)}.`
        : `Cette clé vient ${fromVendor(owner.vendor)} : elle va dans ${owner.service}.`;
    }
    case 'unauthorized':
      return `${vendor} ne reconnaît pas cette clé. Vérifie qu’elle est copiée en entier.`;
    case 'model_not_allowed':
      return provider === 'mistral'
        ? 'Cette clé ne voit pas Mistral Large. Vérifie l’offre du workspace dans la console Mistral.'
        : `Cette clé n’a pas accès à Grok 4.7. Dans la console ${vendor}, ajoute grok-4.7 à ses modèles.`;
    case 'no_credit':
      return `Le compte ${vendor} n’a plus de crédit. Recharge-le, puis réessaie.`;
    case 'api_not_enabled':
      return 'Ce projet Google n’a pas accès à l’API Gemini. Recrée la clé depuis AI Studio.';
    case 'vision_model_missing': {
      const wanted = details.visionModel ?? 'Le modèle de vision';
      const found = details.availableModels ?? [];
      return found.length === 0
        ? `${wanted} n’est pas visible avec cette clé, et aucun modèle Gemini non plus.`
        : `${wanted} n’est pas visible avec cette clé. Modèles trouvés : ${found.join(', ')}.`;
    }
    case 'missing_permission': {
      const label = details.permission === undefined ? undefined : PERMISSION_LABELS[details.permission];
      return label === undefined
        ? `La clé n’a pas tous les accès nécessaires. Vérifie ses accès dans ${vendor}.`
        : `La clé ne peut pas lire tout ce qu’il faut. Ajoute ${label} à ses accès.`;
    }
    // The key was never checked: neither text says whether it is good (recette du 19/10).
    case 'unreachable':
      return details.reason === 'rate_limited'
        ? `${vendor} limite les appels pour l’instant (quota ou trop de requêtes). La clé n’a pas pu être vérifiée ; réessaie dans une minute.`
        : `${vendor} ne répond pas normalement pour l’instant. La clé n’a pas pu être vérifiée ; réessaie dans une minute.`;
  }
}

/** About 100 characters per voice note (vocaux/recherche-et-conception.md). */
const AVERAGE_VOICE_NOTE_CHARACTERS = 100;

function voiceNotesLeft(charactersLeft: number): number {
  return Math.max(0, Math.floor(charactersLeft / AVERAGE_VOICE_NOTE_CHARACTERS));
}

export function describeLowCredit(charactersLeft: number): string {
  return `Plus que ${voiceNotesLeft(charactersLeft).toLocaleString('fr-FR')} vocaux ce mois. Recharge avant d’en manquer.`;
}

/**
 * The Services line of a key that stopped working, by what the provider said: a refused key, an empty account and
 * a missing access are not fixed the same way. `isUnreadable` is a key Nirvana itself can no longer decrypt.
 */
export function describeRefusedLine(
  provider: AiProvider,
  kind: ProviderErrorKind | null,
  isUnreadable: boolean,
): string {
  const profile = profileOf(provider);
  if (isUnreadable)
    return `La clé ${profile.service} enregistrée ne peut plus être déchiffrée. Colle-la à nouveau. ${profile.whileRefused}`;
  if (kind === null || kind === 'unauthorized') return profile.revoked;
  if (kind === 'no_credit') return `Le compte ${profile.vendor} n’a plus de crédit. ${profile.whileRefused}`;
  if (kind === 'missing_permission')
    return `${profile.vendor} refuse les appels de l’agent (accès ou plafond de dépenses). ${profile.whileRefused}`;
  return `${describeRefusal(provider, kind)} ${profile.whileRefused}`;
}

/** The ElevenLabs line and facts, after a check or when another voice is picked. */
export function describeVoiceAccount(
  voice: ProviderVoice | undefined,
  charactersLeft: number,
): { readonly summary: string; readonly facts: readonly ProviderFact[] } {
  const notes = voiceNotesLeft(charactersLeft).toLocaleString('fr-FR');
  return {
    summary:
      voice === undefined
        ? `${notes} vocaux ce mois · aucune voix choisie`
        : `Voix de ${voice.name} · ${notes} vocaux ce mois`,
    facts: [
      { label: 'Ce mois', value: `${notes} vocaux possibles` },
      {
        label: 'Voix',
        value:
          voice?.name ??
          'Aucune voix clonée trouvée. Crée la voix de la créatrice dans ElevenLabs, puis reviens.',
      },
    ],
  };
}
