import type {
  AiCreditCurrency,
  AiCreditProvider,
  AiCredits,
  AiCreditState,
  AiUsage,
  AiUsageProvider,
  AiUsageProviderSpend,
  AiUsageUse,
} from '@impera/contracts';

import { OTHER, SERIES, dayLabel, shortDay } from '@/screens/dashboard/agency/view';

/*
 * Réglages › Consommation IA (ADR 0091): what the screen says of the server's figures. Pure, tested. Colours follow
 * the provider or the use, never its rank (the dataviz series of the Dashboard, validated Nuit and Jour).
 */

/** The services by the model the owner pays for, in the contract's order: one colour each. */
export const PROVIDERS: readonly {
  readonly key: AiUsageProvider;
  readonly label: string;
  readonly colour: string;
}[] = [
  { key: 'xai', label: 'Grok (xAI)', colour: SERIES[0] },
  { key: 'mistral', label: 'Mistral', colour: SERIES[1] },
  { key: 'google', label: 'Gemini (Google)', colour: SERIES[2] },
  { key: 'venice', label: 'Venice', colour: SERIES[3] },
];

export const providerLabel = (provider: AiUsageProvider): string =>
  PROVIDERS.find((p) => p.key === provider)?.label ?? provider;

/** What the money went to, in the owner's words; the tests (judge) fold in the neutral « other ». */
export const USES: Readonly<
  Record<AiUsageUse, { readonly label: string; readonly note: string; readonly colour: string }>
> = {
  voice: {
    label: 'Écrire les messages',
    note: 'la voix de la créatrice, chaque réponse aux fans',
    colour: SERIES[0],
  },
  brain: {
    label: 'Décider quoi répondre',
    note: 'lire la conversation et choisir le geste',
    colour: SERIES[1],
  },
  sense: { label: 'Regarder les médias', note: 'photos, vidéos et vocaux décrits', colour: SERIES[2] },
  trend_watch: { label: 'Veille des tendances', note: 'les idées de contenu', colour: SERIES[3] },
  judge: { label: 'Tests de qualité', note: 'les évaluations de l’agent', colour: OTHER },
};

/** « 3,42 € », to the cent; under a cent « 0,004 € », so a cheap call never reads as free. */
export function eurText(eur: number): string {
  if (eur > 0 && eur < 0.01) {
    return `${eur.toLocaleString('fr-FR', { maximumSignificantDigits: 1 })}\u00a0€`;
  }
  return `${eur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;
}

/** « 12 € », « 1,5 € »: an axis label, never a figure to read. */
export function axisEur(eur: number): string {
  return `${eur.toLocaleString('fr-FR', { maximumFractionDigits: eur < 10 ? 1 : 0 })}\u00a0€`;
}

/** Credits in the provider's own currency: « 23,40 $ » or « 23,40 € ». */
export function creditText(minor: number, currency: AiCreditCurrency): string {
  const sign = currency === 'EUR' ? '€' : '$';
  return `${(minor / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0${sign}`;
}

/** « 1,2 M », « 34 k », « 812 »: tokens, read at a glance. */
export function tokensText(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u00a0M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000).toLocaleString('fr-FR')}\u00a0k`;
  return tokens.toLocaleString('fr-FR');
}

export const countText = (n: number): string => n.toLocaleString('fr-FR');

/** The share of today's spend in the cap, 0 to 100, for the gauge. */
export function capShare(usage: AiUsage): number {
  return Math.min(100, Math.max(0, (usage.today.eur / usage.today.capEur) * 100));
}

/** What the gauge says under it, by the cap's state. */
export function capNote(usage: AiUsage): string {
  const { today } = usage;
  if (today.state === 'reached')
    return 'Plafond atteint : l’IA ne répond plus jusqu’à minuit, les chatteurs reprennent.';
  const left = today.capEur - today.eur;
  if (today.state === 'alert') return `Plus que ${eurText(left)} avant le plafond du jour.`;
  return `${eurText(left)} de marge avant le plafond du jour (${eurText(today.capEur)}).`;
}

/** « il y a 12 s », « il y a 4 min », « à 14:02 »: how fresh the last call is, said from `now`. */
export function sinceText(at: string | null, now: Date, timeZone: string): string {
  if (at === null) return 'aucun appel ces 30 derniers jours';
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 1000));
  if (seconds < 60) return `dernier appel il y a ${String(seconds)} s`;
  if (seconds < 3600) return `dernier appel il y a ${String(Math.round(seconds / 60))} min`;
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(at),
  );
  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at)) ===
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  return sameDay
    ? `dernier appel à ${time}`
    : `dernier appel le ${dayLabel(new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at)))}`;
}

/** A column of the chart: a day, or an hour of today. */
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly eur: number;
  readonly calls: number;
  /** Bottom to top, in `PROVIDERS`' order, one per provider (0 where it cost nothing). */
  readonly parts: readonly number[];
}

const partsOf = (providers: readonly AiUsageProviderSpend[]): number[] =>
  PROVIDERS.map((p) => providers.find((one) => one.provider === p.key)?.eur ?? 0);

export function dayColumns(usage: AiUsage): Column[] {
  return usage.days.map((day) => ({
    key: day.day,
    label: shortDay(day.day),
    title: day.day === usage.today.day ? `Aujourd’hui, ${dayLabel(day.day)}` : dayLabel(day.day),
    eur: day.eur,
    calls: day.calls,
    parts: partsOf(day.providers),
  }));
}

export function hourColumns(usage: AiUsage): Column[] {
  return usage.hours.map((hour) => ({
    key: String(hour.hour),
    label: `${String(hour.hour)}h`,
    title: `${String(hour.hour)}h–${String((hour.hour + 1) % 24)}h`,
    eur: hour.eur,
    calls: hour.calls,
    parts: partsOf(hour.providers),
  }));
}

/** A slice of a ring: a model or a use, its colour fixed by what it is. */
export interface Slice {
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly colour: string;
  readonly eur: number;
}

/** One slice per model, coloured by its provider; a second model of a provider takes the neutral colour. */
export function modelSlices(usage: AiUsage): Slice[] {
  const seen = new Set<AiUsageProvider>();
  return usage.models
    .filter((model) => model.eur > 0)
    .map((model) => {
      const first = !seen.has(model.provider);
      seen.add(model.provider);
      const parts = [
        `${countText(model.calls)} appel${model.calls > 1 ? 's' : ''}`,
        `${tokensText(model.inputTokens)} jetons lus, ${tokensText(model.outputTokens)} écrits`,
        ...(model.fallback > 0 ? [`${countText(model.fallback)} en secours`] : []),
        ...(model.failed > 0 ? [`${countText(model.failed)} en erreur`] : []),
      ];
      return {
        key: `${model.provider}:${model.model}`,
        label: model.model,
        note: `${providerLabel(model.provider)} · ${parts.join(' · ')}`,
        colour: first ? (PROVIDERS.find((p) => p.key === model.provider)?.colour ?? OTHER) : OTHER,
        eur: model.eur,
      };
    });
}

export function useSlices(usage: AiUsage): Slice[] {
  return usage.uses
    .filter((use) => use.eur > 0)
    .map((use) => ({
      key: use.use,
      label: USES[use.use].label,
      note: `${USES[use.use].note} · ${countText(use.calls)} appel${use.calls > 1 ? 's' : ''}`,
      colour: USES[use.use].colour,
      eur: use.eur,
    }));
}

/** The share of `part` in `whole`, in %, rounded; 0 for an empty whole. */
export function shareOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** The credits services, as the dialog offers them. */
export const CREDIT_PROVIDERS: readonly { readonly key: AiCreditProvider; readonly label: string }[] = [
  { key: 'xai', label: 'Grok (xAI)' },
  { key: 'mistral', label: 'Mistral' },
  { key: 'google', label: 'Gemini (Google)' },
];

/** Where each provider shows its balance, for the dialog's hint. */
export const CONSOLE_HINT: Readonly<Record<AiCreditProvider, string>> = {
  xai: 'console.x.ai › Billing',
  mistral: 'console.mistral.ai › Billing',
  google: 'aistudio.google.com › Billing',
};

/** Where each provider shows the usage its subscription includes (ADR 0091 § 6). */
export const USAGE_HINT: Readonly<Record<AiCreditProvider, string>> = {
  xai: 'console.x.ai › Usage',
  mistral: 'console.mistral.ai › Usage',
  google: 'aistudio.google.com › Usage',
};

/** The tone of a card, as the rest of the CRM says it: amber a warning, red an urgency. */
export const CREDIT_TONE: Readonly<Record<AiCreditState, 'ok' | 'warn' | 'bad' | 'idle'>> = {
  ok: 'ok',
  low: 'warn',
  critical: 'bad',
  empty: 'bad',
  unknown_pace: 'idle',
  included: 'ok',
  quota_reached: 'bad',
};

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** « samedi 14 novembre »: a calendar day in a sentence, never shifted by a zone. */
export const longDay = (day: string): string => LONG_DAY.format(new Date(`${day}T12:00:00Z`));

const REFUSED_AT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** « jeudi 12 novembre à 23:35 »: when the provider first refused, in Paris time. */
export const refusedText = (at: string): string => REFUSED_AT.format(new Date(at));

/** The card's headline about time: how long, and until when; on a subscription, whether the quota holds. */
export function runwayText(card: AiCredits): string {
  if (card.state === 'quota_reached' && card.quotaRefusedAt !== null)
    return `Depuis ${refusedText(card.quotaRefusedAt)}, l’agent répond avec son modèle de repli jusqu’à la remise à zéro.`;
  if (card.mode === 'subscription')
    return 'Les appels passent sur le quota de ton abonnement. S’il est épuisé, Telegram te prévient.';
  if (card.state === 'empty') return 'Épuisés d’après le décompte : recharge, puis note-le ici.';
  if (card.perDayMinor === 0) return 'Rien dépensé ces derniers jours : le solde ne baisse pas.';
  if (card.daysLeft === null || card.runsOutOn === null)
    return 'Pas encore de rythme : il faut une journée complète de dépense.';
  const days = card.daysLeft;
  const span =
    days < 1
      ? 'moins d’un jour'
      : days >= 60
        ? 'plus de deux mois'
        : `${String(Math.floor(days))} jour${Math.floor(days) > 1 ? 's' : ''}`;
  return `Environ ${span} au rythme actuel, jusqu’au ${longDay(card.runsOutOn)}.`;
}

/** The badge beside the provider's name. */
export const CREDIT_BADGE: Readonly<Record<AiCreditState, string>> = {
  ok: 'Tranquille',
  low: 'Recharger bientôt',
  critical: 'Recharger maintenant',
  empty: 'Épuisés',
  unknown_pace: 'Rythme à venir',
  included: 'Abonnement',
  quota_reached: 'Quota épuisé',
};

/** Share of a 30-day bar the runway fills: the card's little gauge (0 to 100). */
export function runwayShare(card: AiCredits): number {
  if (card.state === 'empty' || card.state === 'quota_reached') return 0;
  if (card.mode === 'subscription') return 100;
  if (card.daysLeft === null) return 100;
  return Math.min(100, (card.daysLeft / 30) * 100);
}
