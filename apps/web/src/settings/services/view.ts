import type {
  ProviderActivity,
  ProviderNextAction,
  ProviderProbe,
  ProviderProbeOutcome,
  ProviderQuota,
  ProviderStatus,
  ProviderTrouble,
} from '@impera/contracts';

import { GUIDES, isDashboardProvider, type DashboardProvider } from './guide';

/** Small view rules of the Services section, kept out of the components so they are tested. */

/** « vérifié à l'instant », « vérifié il y a 12 min », « vérifié il y a 3 h ». */
export function checkedAgo(verifiedAt: string | null, now: Date): string | null {
  if (verifiedAt === null) return null;
  const minutes = Math.floor((now.getTime() - new Date(verifiedAt).getTime()) / 60_000);
  if (minutes < 1) return 'vérifié à l’instant';
  if (minutes < 60) return `vérifié il y a ${String(minutes)} min`;
  return `vérifié il y a ${String(Math.floor(minutes / 60))} h`;
}

/** A key read from the environment (development only) works: the page must not say the agent is stopped. */
function isFromEnvironment(status: ProviderStatus): boolean {
  return status.source === 'environment';
}

/** A service that can write in Grok's place: Mistral, then Venice. */
const RELAYS = ['mistral', 'venice'] as const;
const RELAY_NAMES: Record<(typeof RELAYS)[number], string> = { mistral: 'Mistral', venice: 'Venice' };

const isWorking = (status: ProviderStatus): boolean =>
  isFromEnvironment(status) || status.state === 'connected' || status.state === 'low_credit';

/**
 * The title at the top. Grok's key refused says what it means for the agent, from the states on the same page:
 * without a working relay the agent writes no more; with one, the relay writes instead (recette du 29/10, REG-02).
 * Any other action keeps the server's words.
 */
export function leadOf(next: ProviderNextAction, services: readonly ProviderStatus[]): string {
  if (next.kind !== 'replace_key' || next.provider !== 'xai') return next.lead;
  const grok = services.find((s) => s.provider === 'xai');
  const relay = RELAYS.find((provider) => services.some((s) => s.provider === provider && isWorking(s)));
  if (relay === undefined) {
    const why =
      grok?.isUnreadable === true ? 'Impera ne peut plus lire la clé de Grok' : 'xAI refuse la clé de Grok';
    return `L’agent n’écrit plus : ${why} et aucun relais n’est branché.`;
  }
  return grok?.isUnreadable === true
    ? next.lead
    : `xAI refuse la clé. ${RELAY_NAMES[relay]} écrit à la place de Grok.`;
}

/**
 * The line of the service the top already explains, in two words: the full sentence is in the title just above
 * (REG-04). `null`: the row keeps its own line.
 */
export function shortStateOf(status: ProviderStatus): string | null {
  if (status.state === 'low_credit') return 'Crédit bas';
  if (status.state !== 'needs_reconnect') return null;
  return status.isUnreadable ? 'Clé illisible' : 'Clé refusée';
}

/** The label of the sheet's last button: the next service still to connect, or « Terminé ». */
export function nextAfter(
  services: readonly ProviderStatus[],
  current: DashboardProvider,
): { label: string; provider: DashboardProvider | null } {
  const next = services.find(
    (s) => s.provider !== current && s.state === 'not_connected' && !isFromEnvironment(s),
  );
  if (next === undefined || !isDashboardProvider(next.provider)) return { label: 'Terminé', provider: null };
  return { label: `Continuer avec ${GUIDES[next.provider].name}`, provider: next.provider };
}

export type Dot = 'ok' | 'off' | 'must' | 'low' | 'bad' | 'busy';

export function dotOf(status: ProviderStatus, isVerifying: boolean): Dot {
  if (isVerifying) return 'busy';
  if (isFromEnvironment(status)) return 'ok';
  switch (status.state) {
    case 'connected':
      // The key passes its check, but a real call says the account cannot pay (ADR 0091 § 7): amber, not calm.
      return isBlockedInUse(status) ? 'low' : 'ok';
    case 'low_credit':
      return 'low';
    case 'needs_reconnect':
      return 'bad';
    case 'not_connected':
      return isDashboardProvider(status.provider) && GUIDES[status.provider].isRequired ? 'must' : 'off';
  }
}

export function dotOfNext(next: ProviderNextAction): Dot {
  switch (next.kind) {
    case 'all_set':
      return 'ok';
    case 'replace_key':
      return 'bad';
    case 'top_up':
      return 'low';
    case 'connect':
      return isDashboardProvider(next.provider) && GUIDES[next.provider].isRequired ? 'must' : 'off';
  }
}

/**
 * « Vérifier maintenant » answers with the status as it stands. When the provider could not be reached, the
 * server keeps the last verification: same `verifiedAt`. The page says so instead of saying nothing. A key Impera
 * can no longer decrypt is never sent: the provider was not called, and the notice says what to do instead.
 */
export function verifyNotice(
  provider: DashboardProvider,
  before: ProviderStatus,
  after: ProviderStatus,
): string | null {
  if (after.isUnreadable)
    return `Impera ne peut plus lire la clé enregistrée : ${GUIDES[provider].vendor} n’a pas été contacté. Colle la clé à nouveau.`;
  // Every answer of the provider, a refusal included, moves `verifiedAt` (domain/credential.ts on the API).
  if (before.verifiedAt !== after.verifiedAt) return null;
  return `${GUIDES[provider].vendor} n’a pas répondu. L’état affiché est celui de la dernière vérification.`;
}

/** A key never contains whitespace: a key pasted with a line break or spaces in it still works. */
export function normalizeKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/*
 * « Essai réel » and the health of each service (ADR 0091 § 7): what the last tiny real call found, and what the
 * agent's own calls of the last 24 hours say.
 */

export type Tone = 'ok' | 'warn' | 'bad';

/** The chip of an « Essai réel », in two or three words. Amber is a setting or a wait; red, the service is broken. */
export const PROBE_CHIP: Readonly<
  Record<ProviderProbeOutcome, { readonly text: string; readonly tone: Tone }>
> = {
  answers: { text: 'Répond', tone: 'ok' },
  budget_reached: { text: 'Plafond du jour atteint', tone: 'warn' },
  no_voice: { text: 'Aucune voix choisie', tone: 'warn' },
  no_credit: { text: 'Plus de crédit', tone: 'bad' },
  key_refused: { text: 'Clé refusée', tone: 'bad' },
  model_missing: { text: 'Modèle absent du compte', tone: 'bad' },
  rate_limited: { text: 'Trop d’appels, réessaie', tone: 'warn' },
  timeout: { text: 'Trop lent', tone: 'warn' },
  not_answering: { text: 'Ne répond pas', tone: 'warn' },
};

/** What the chip means, said once under it: what to do, never a code. */
export const PROBE_HINT: Readonly<Record<ProviderProbeOutcome, string | null>> = {
  answers: null,
  budget_reached: 'Le plafond IA du jour est atteint : aucun appel n’est parti. Il revient à minuit.',
  no_voice: 'Choisis une voix pour ElevenLabs, puis refais l’essai.',
  no_credit: 'Le compte n’a plus de crédit ni de quota : recharge-le dans la console du service.',
  key_refused: 'Le service a refusé la clé sur un vrai appel : remplace-la.',
  model_missing: 'Le compte n’a pas accès au modèle qu’utilise l’agent : vérifie les droits de la clé.',
  rate_limited: 'Le service limite les appels en ce moment. Réessaie dans une minute.',
  timeout: 'Le service a mis plus de 20 secondes. Réessaie dans un instant.',
  not_answering: 'Le service ne répond pas normalement. Réessaie dans un instant.',
};

/** What one « Essai réel » costs, said on its button: the owner agreed to pay it per click (« ok essai IA »). */
export const PROBE_COST: Readonly<Record<DashboardProvider, string>> = {
  xai: 'Un tout petit appel réel, moins d’un centime, inclus si tu es sur l’abonnement',
  google: 'Un tout petit appel réel, moins d’un centime',
  mistral: 'Un tout petit appel réel, moins d’un centime',
  elevenlabs: 'Un « ok » prononcé : deux caractères de ton mois',
};

/** The last trouble of the agent's calls, as a reason. */
export const TROUBLE_TEXT: Readonly<Record<ProviderTrouble, string>> = {
  no_credit: 'plus de crédit ou de quota',
  key_refused: 'clé refusée',
  model_missing: 'modèle absent du compte',
  rate_limited: 'trop d’appels',
  timeout: 'trop lent',
  not_answering: 'le service ne répondait pas',
};

/**
 * The latest trouble of the agent's calls, unless the last « Essai réel » came after it: the essai is then the fresher
 * word (and was journaled itself), so the same failure is not said twice.
 */
export function troubleToShow(status: ProviderStatus): ProviderActivity['lastTrouble'] {
  const trouble = status.activity?.lastTrouble ?? null;
  if (trouble === null) return null;
  return status.probe !== null && Date.parse(status.probe.at) >= Date.parse(trouble.at) ? null : trouble;
}

/** The last essai, or else the last trouble, says the account cannot generate until someone acts. */
function isBlockedInUse(status: ProviderStatus): boolean {
  const trouble = troubleToShow(status);
  if (trouble !== null) return troubleTone(trouble.kind) === 'bad';
  return status.probe !== null && PROBE_CHIP[status.probe.outcome].tone === 'bad';
}

/**
 * The tone shown on a service still connected: its dot is amber when it cannot generate (a relay with no credit is
 * a warning, nothing urgent), so its chip and its last error say amber too. Red stays for a service no longer
 * connected, its key to enter again.
 */
export function inUseTone(status: ProviderStatus, tone: Tone): Tone {
  return tone === 'bad' && (status.state === 'connected' || status.state === 'low_credit') ? 'warn' : tone;
}

/** Red for what stops the service until someone acts, amber for what passes on its own. */
export function troubleTone(kind: ProviderTrouble): Tone {
  return kind === 'no_credit' || kind === 'key_refused' || kind === 'model_missing' ? 'bad' : 'warn';
}

/** « à l’instant », « il y a 12 min », « il y a 3 h », « il y a 2 j ». */
export function agoText(at: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${String(hours)} h`;
  return `il y a ${String(Math.floor(hours / 24))} j`;
}

/** « 0,6 s », « 12 s ». */
export function secondsText(ms: number): string {
  const seconds = ms / 1000;
  return `${seconds.toLocaleString('fr-FR', { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`;
}

/** Under the chip: when, on which model, how fast. */
export function probeDetail(probe: ProviderProbe, now: Date): string {
  return [agoText(probe.at, now), probe.model, probe.latencyMs === null ? null : secondsText(probe.latencyMs)]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

const plural = (n: number, word: string): string => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;

export interface HealthStat {
  readonly label: string;
  readonly value: string;
  readonly tone: Tone | null;
}

/** Whose place a service takes when it answers as a fallback. */
const STANDS_IN_FOR: Partial<Record<DashboardProvider, string>> = { mistral: 'Grok', xai: 'Gemini' };

/** The three small figures of a connected service: its last success, its day, and its relays. */
export function healthStats(
  provider: DashboardProvider,
  activity: ProviderActivity,
  now: Date,
): HealthStat[] {
  const stats: HealthStat[] = [
    {
      label: 'Dernier appel réussi',
      value: activity.lastSuccessAt === null ? 'aucun sur 7 jours' : agoText(activity.lastSuccessAt, now),
      tone: null,
    },
    {
      label: 'Sur 24 h',
      value:
        activity.calls === 0
          ? 'aucun appel'
          : activity.troubled === 0
            ? `${plural(activity.calls, 'appel')}, sans erreur`
            : `${plural(activity.calls, 'appel')}, ${plural(activity.troubled, 'erreur')}`,
      tone: activity.troubled === 0 ? null : activity.troubled * 5 > activity.calls ? 'warn' : null,
    },
  ];
  const standsInFor = STANDS_IN_FOR[provider];
  if (standsInFor !== undefined && (provider === 'mistral' || activity.asFallback > 0)) {
    stats.push({
      label: `En relais de ${standsInFor}`,
      value: activity.asFallback === 0 ? 'pas sollicité' : plural(activity.asFallback, 'fois'),
      tone: null,
    });
  }
  return stats;
}

/** ElevenLabs' month: what is used of it, and when it comes back. */
export function quotaText(quota: ProviderQuota): { readonly used: string; readonly resets: string | null } {
  const resets =
    quota.resetsAt === null
      ? null
      : `revient le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(quota.resetsAt)).replace(/^1 /u, '1er ')}`;
  return {
    used: `${quota.used.toLocaleString('fr-FR')} sur ${quota.limit.toLocaleString('fr-FR')} caractères ce mois`,
    resets,
  };
}

/** Share of the month used, 0 to 100; a month without a limit reads as used up. */
export function quotaShare(quota: ProviderQuota): number {
  return quota.limit === 0 ? 100 : Math.min(100, (quota.used / quota.limit) * 100);
}

/** Amber under 10 % left (as the line's « Crédit bas »), red when nothing is left. */
export function quotaTone(quota: ProviderQuota): Tone {
  if (quota.used >= quota.limit) return 'bad';
  return quota.limit - quota.used < quota.limit * 0.1 ? 'warn' : 'ok';
}

/** ElevenLabs' free offer forbids commercial use: said before the voice notes go live, never as a block. */
export const FREE_PLAN_NOTE =
  'Offre gratuite d’ElevenLabs : l’usage commercial n’y est pas autorisé. Passe à une offre payante avant de lancer les vocaux.';
