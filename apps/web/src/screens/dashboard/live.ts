import {
  type HandoffCause,
  type Dashboard as ApiDashboard,
  type DashboardFan,
  type DashboardTodo,
} from '@nirvana/contracts';

import { eur } from './logic';
import type { AgentCard, AgentState, Dashboard, Fan, Todo } from './model';

import { CAUSE_LABELS } from '@/agent/causes';
import { percent } from '@/agent/mode';
import { cityOf, clockAt, lengthOf, readerZone, withFirstOfMonth } from '@/scheduling/time';
import { telegramNightOf } from '@/settings/telegram/NightBanner';

/*
 * `GET /v1/dashboard` in the screen's words. The server measured everything; this file only writes it in French,
 * in the creator's time zone. Sales stay out until the Reveal connector observes purchases.
 */

/** What a handoff or a waiting draft is called on the screen, in the trade's words. */
const KIND_LABEL: Readonly<Record<DashboardTodo['kind'], string>> = {
  ...CAUSE_LABELS,
  awaiting_approval: 'À valider dans Suivi',
  send_failed: 'Envoi échoué',
  unanswered: 'Sans réponse',
};

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/** « 7,40 € »: the AI spend is small, its cents matter. */
const euroCents = (value: number): string =>
  `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;

/** « 1 min 40 » from minutes with a tenth; « 45 s » under a minute. */
export function replyDelay(minutes: number): string {
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${String(seconds)} s`;
  const rest = seconds % 60;
  return rest === 0
    ? `${String(Math.floor(seconds / 60))} min`
    : `${String(Math.floor(seconds / 60))} min ${String(rest).padStart(2, '0')}`;
}

/** « il y a 14 s », « il y a 3 min », « il y a 2 h », « il y a 4 j ». */
export function ago(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `il y a ${String(seconds)} s`;
  if (seconds < 3600) return `il y a ${String(Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) return `il y a ${String(Math.floor(seconds / 3600))} h`;
  return `il y a ${String(Math.floor(seconds / 86_400))} j`;
}

/** « 3 semaines », « 2 mois », « 5 jours »: how long ago a fan first wrote. */
function since(iso: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  if (days < 14) return plural(Math.max(1, days), 'jour', 'jours');
  if (days < 60) return plural(Math.floor(days / 7), 'semaine', 'semaines');
  if (days < 365) return `${String(Math.floor(days / 30))} mois`;
  return plural(Math.floor(days / 365), 'an', 'ans');
}

/**
 * « lundi 19 octobre, 14 h 02 », in her time zone: the hours are written as everywhere else in the CRM (DASH-26). When the reader's clock reads another time, the city of hers follows
 * (« …, heure de Tokyo »): every time of the page is hers (recette 28/10, M15).
 */
function today(iso: string, timeZone: string, viewerZone: string): string {
  const at = (zone: string): string =>
    `${withFirstOfMonth(
      new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: zone,
      }).formatToParts(new Date(iso)),
    )}, ${clockAt(iso, zone)}`;
  const hers = at(timeZone);
  return hers === at(viewerZone) ? hers : `${hers}, heure de ${cityOf(timeZone)}`;
}

/**
 * The handoffs a guard set off: what the fan wrote or what the agent was about to write. Named one by one, so that a new
 * cause counts only once it is put here: a ceiling of spend reached, a voice that does not answer, no active persona or
 * a hand given for no named reason are relays, not guards, and their own cards say them.
 */
const GUARD_CAUSES = [
  'minor',
  'non_consent',
  'distress',
  'meeting',
  'manipulation',
  'guard',
  'keyword',
  'custom_alert',
  'identity_doubt',
] as const satisfies readonly HandoffCause[];

/** Over which span the reply delay is measured: the period of the page. */
const REPLY_SPAN: Readonly<Record<ApiDashboard['period'], string>> = {
  day: 'aujourd’hui',
  week: 'sur 7 jours',
  month: 'sur 30 jours',
};

function agentState(api: ApiDashboard, now: Date, reader: DashboardReader): AgentState {
  const forCreator = reader === 'creator';
  const { reveal, voice, jobs, replies, guards, budget, liveRate, todos } = api;
  // Never read once and not connected: no account was ever linked. A step to come, not an outage.
  const unlinked = !reveal.connected && reveal.lastReadAt === null;
  // The session holds but nobody reads it any more: never green, the last read says since when.
  const late = reveal.connected && reveal.late;
  const relays = GUARD_CAUSES.reduce((sum, cause) => sum + guards.today[cause], 0);
  // « 64,5 % validés sans retouche, objectif 80 % »: the rate with what it aims at (DASH-16).
  const rateText =
    liveRate.rate === null ? 'pas encore mesuré' : `${percent(liveRate.rate)} validés sans retouche`;
  const rateOk = liveRate.rate !== null && liveRate.rate >= liveRate.target;
  // Null for a creator: the agency's spend is not hers (ADR 0023), and her fold leaves the card out.
  const spent = budget.spentToday;
  const budgetTone =
    spent === null ? 'ok' : spent >= budget.cap ? 'bad' : spent >= budget.alertAt ? 'warn' : 'ok';
  const budgetCard: AgentCard | null =
    spent === null
      ? null
      : {
          id: 'budget',
          tone: budgetTone,
          title: 'Budget IA du jour',
          value: `${euroCents(spent)} sur ${eur(budget.cap)}`,
          sub: `alerte à ${eur(budget.alertAt)}, arrêt à ${eur(budget.cap)}`,
          rows: [
            ['Compté', 'pour toutes les créatrices'],
            ['Alerte', `à ${eur(budget.alertAt)}`],
            [`Au-delà de ${eur(budget.cap)}`, 'l’agent s’arrête'],
          ],
          gauge: {
            kind: 'spend',
            value: budget.cap > 0 ? Math.min(100, Math.round((spent / budget.cap) * 100)) : 0,
            mark: budget.cap > 0 ? Math.round((budget.alertAt / budget.cap) * 100) : 0,
          },
          alarm:
            budgetTone === 'bad' ? 'Le budget IA du jour est atteint' : 'Le budget IA approche du plafond',
        };
  const lastRead = reveal.lastReadAt === null ? null : ago(reveal.lastReadAt, now);
  const waitingLong = replies.fansWaitingOver10Min;
  const dead = forCreator ? 0 : (jobs.dead ?? 0);
  const cards: AgentState['cards'] = [
    {
      id: 'reveal',
      tone: late ? 'warn' : reveal.connected ? 'ok' : unlinked ? 'idle' : 'bad',
      title: 'Connexion à Reveal',
      value: late
        ? 'Lecture en retard'
        : reveal.connected
          ? 'Connectée'
          : unlinked
            ? 'Pas encore reliée'
            : 'Déconnectée',
      sub: lastRead === null ? 'jamais lue' : `lue ${lastRead}`,
      rows: [
        ['Dernière lecture', lastRead ?? 'jamais'],
        ['Conversations suivies', String(reveal.conversations)],
      ],
      alarm: late ? 'Reveal n’est plus lu' : 'Reveal est déconnecté',
    },
    {
      id: 'voice',
      // No key is a step to take, not an outage: amber, and the tip says where the key goes.
      tone: voice.ok ? 'ok' : voice.keyMissing ? 'warn' : 'bad',
      title: 'IA qui écrit les messages',
      value: voice.ok ? 'En service' : voice.keyMissing ? 'Clé manquante' : 'Ne répond plus',
      // Réglages is the owner's alone: anyone else of the team reads who sets the key, as the hero says it.
      sub:
        voice.keyMissing && !forCreator
          ? reader === 'owner'
            ? 'à poser dans Réglages › Modèles IA'
            : 'posée par le propriétaire dans Réglages › Modèles IA'
          : voice.medianWriteMs === null
            ? 'temps pour écrire pas encore mesuré'
            : `écrit en ${(voice.medianWriteMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`,
      rows: [
        ...(voice.keyMissing && !forCreator
          ? [
              reader === 'owner'
                ? (['À poser dans', 'Réglages › Modèles IA'] as const)
                : (['Posée par', 'le propriétaire, dans Réglages › Modèles IA'] as const),
            ]
          : []),
        [
          'Temps pour écrire',
          voice.medianWriteMs === null
            ? 'pas encore mesuré'
            : `${(voice.medianWriteMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`,
        ],
        [
          'Pannes',
          voice.outagesLast7d === 0
            ? 'aucune en 7 j'
            : `${plural(voice.outagesLast7d, 'heure', 'heures')} en 7 j`,
        ],
      ],
      alarm: voice.keyMissing ? 'L’IA qui écrit attend sa clé' : 'L’IA qui écrit ne répond plus',
    },
    {
      id: 'activity',
      // A job the worker gave up on is work that will not happen until someone looks: amber.
      tone: waitingLong > 0 || dead > 0 ? 'warn' : 'ok',
      // Measured over the period chosen for the sales: the title says which (recette 28/10, M11).
      title: `Délai de réponse habituel ${REPLY_SPAN[api.period]}`,
      value:
        replies.medianReplyMinutes === null ? 'pas encore mesuré' : replyDelay(replies.medianReplyMinutes),
      sub:
        waitingLong > 0
          ? `${plural(waitingLong, 'fan attend', 'fans attendent')} plus de 10 min`
          : dead > 0
            ? `${plural(dead, 'tâche bloquée', 'tâches bloquées')}, à regarder`
            : plural(replies.conversationsOpen, 'conversation en cours', 'conversations en cours'),
      rows: [
        ['Conversations en cours', String(replies.conversationsOpen)],
        ['Fans qui attendent plus de 10 min', String(waitingLong)],
        // The agency's work queue: a creator does not read it (ADR 0023).
        ...(forCreator
          ? []
          : [
              [
                'Tâches bloquées',
                jobs.dead === null
                  ? 'pas lu'
                  : jobs.dead === 0
                    ? 'aucune'
                    : `${String(jobs.dead)}, à regarder`,
              ] as const,
            ]),
      ],
      alarm:
        waitingLong > 0
          ? `${plural(waitingLong, 'fan attend', 'fans attendent')} depuis plus de 10 min`
          : plural(dead, 'tâche est bloquée', 'tâches sont bloquées'),
    },
    {
      // The handoffs the guards made, by cause: « Passages à l’humain », the glossary's word, never « gardes » (DASH-16).
      id: 'relays',
      tone: relays > 0 ? 'warn' : 'ok',
      title: 'Passages à l’humain',
      value: relays === 0 ? 'aucun aujourd’hui' : `${String(relays)} aujourd’hui`,
      sub:
        guards.telegramAlertsTonight === null
          ? 'Telegram éteint'
          : `${plural(guards.telegramAlertsTonight, 'alerte', 'alertes')} Telegram cette nuit`,
      rows: [
        ...GUARD_CAUSES.filter((cause) => guards.today[cause] > 0).map((cause): [string, string] => [
          KIND_LABEL[cause],
          String(guards.today[cause]),
        ]),
        [
          'Alertes Telegram cette nuit',
          guards.telegramAlertsTonight === null ? 'Telegram éteint' : String(guards.telegramAlertsTonight),
        ],
      ],
    },
    ...(budgetCard === null ? [] : [budgetCard]),
    {
      id: 'live-rate',
      tone: rateOk ? 'ok' : 'warn',
      title: 'Taux en réel',
      value: liveRate.rate === null ? 'pas encore mesuré' : `${percent(liveRate.rate)} sans retouche`,
      sub: `objectif ${percent(liveRate.target)}, sur ${plural(liveRate.decided, 'brouillon décidé', 'brouillons décidés')}`,
      rows: [
        ['Sur', plural(liveRate.decided, 'brouillon décidé', 'brouillons décidés')],
        [
          'Il y a 3 semaines',
          liveRate.threeWeeksAgo === null ? 'pas encore mesuré' : percent(liveRate.threeWeeksAgo),
        ],
        ['Automatique', `à partir de ${percent(liveRate.target)}`],
      ],
      gauge: { kind: 'rate', value: liveRate.rate ?? 0, mark: liveRate.target },
    },
  ];

  const summary = [
    `Reveal ${late ? 'lu en retard' : reveal.connected ? 'connecté' : unlinked ? 'pas encore relié' : 'déconnecté'}`,
    plural(reveal.conversations, 'conversation', 'conversations'),
    // The handoffs are the team's work: a creator reads the agent's state, not its relays (DASH-21).
    ...(forCreator ? [] : [plural(relays, 'passage à l’humain', 'passages à l’humain')]),
    ...(dead > 0 ? [plural(dead, 'tâche bloquée', 'tâches bloquées')] : []),
    ...(spent === null ? [] : [`${euroCents(spent)} sur ${eur(budget.cap)}`]),
    // Said with what it measures and what it aims at: « pas encore mesuré » alone names nothing (DASH-16).
    liveRate.rate === null
      ? 'taux en réel pas encore mesuré'
      : `${rateText}, objectif ${percent(liveRate.target)}`,
  ].join(' · ');
  const base = {
    eyebrow: plural(reveal.conversations, 'conversation', 'conversations'),
    foldSummary: summary,
    cards,
    // Past its alert, the AI budget is said in the hero too: the agent will stop at its cap (DASH-06).
    ...(spent !== null && budgetTone !== 'ok'
      ? {
          budgetNote:
            budgetTone === 'bad'
              ? `Le budget IA du jour est atteint (${euroCents(spent)} sur ${eur(budget.cap)}) : l’agent ne propose plus rien jusqu’à demain.`
              : `À ${euroCents(spent)} sur ${eur(budget.cap)} de budget IA, l’agent s’arrêtera bientôt.`,
        }
      : {}),
  };
  // Reveal speaks first, but a voice down too is said in the same sentence, never only in the fold.
  const alsoVoice = voice.ok
    ? ''
    : voice.keyMissing
      ? ' L’IA qui écrit attend aussi sa clé.'
      : ' L’IA qui écrit ne répond pas non plus.';
  if (unlinked) {
    return {
      ...base,
      tone: 'idle',
      headline: 'Reveal n’est **pas encore relié**',
      lead: `L’agent commencera à lire les conversations dès que la session Reveal sera capturée depuis l’extension.${alsoVoice}`,
      foldTitle: 'Rien ne tourne encore',
    };
  }
  // An agent in trouble says so before anything that waits: Reveal first, it is what everything reads.
  if (!reveal.connected) {
    return {
      ...base,
      tone: 'bad',
      headline: 'Reveal est **déconnecté**',
      // Since when, in the sentence itself, not only in the fold (DASH-18).
      lead: `${lastRead === null ? '' : `Dernière lecture ${lastRead}. `}L’agent ne lit plus les conversations. Reconnecte la session Reveal depuis l’extension.${alsoVoice}`,
      foldTitle: 'Quelque chose ne va pas',
    };
  }
  // The session holds, nothing reads it: not an outage of Reveal, but the fans' messages no longer come in.
  if (late && reveal.lastReadAt !== null) {
    return {
      ...base,
      tone: 'warn',
      stalled: true,
      headline: 'Reveal n’est **plus lu**',
      lead: `La session tient, mais Reveal a été lu pour la dernière fois ${ago(reveal.lastReadAt, now)}. Les nouveaux messages des fans n’arrivent plus à l’agent.${alsoVoice}`,
      foldTitle: 'Quelque chose ne va pas',
    };
  }
  if (voice.keyMissing) {
    return {
      ...base,
      tone: 'warn',
      stalled: true,
      headline: 'L’IA qui écrit **attend sa clé**',
      lead: 'Pose-la dans Réglages › Modèles IA. D’ici là, les conversations restent aux chatteurs dans Reveal.',
      action: 'Poser la clé',
      actionTo: '/reglages/modeles-ia',
      leadWithoutAction:
        'Le propriétaire la pose dans Réglages › Modèles IA. D’ici là, les conversations restent aux chatteurs dans Reveal.',
      foldTitle: 'Une étape reste à faire',
    };
  }
  if (!voice.ok) {
    return {
      ...base,
      tone: 'bad',
      headline: 'L’IA qui écrit **ne répond plus**',
      lead: 'Les conversations passent aux chatteurs dans Reveal jusqu’à son retour.',
      foldTitle: 'Quelque chose ne va pas',
    };
  }
  // Under an urgency the hero names where to start, without saying the line of « À traiter » again (DASH-10).
  const urgent = todos.find((todo) => todo.tone === 'bad');
  return {
    ...base,
    tone: cards.some((card) => card.tone !== 'ok') ? 'warn' : 'ok',
    headline: '',
    lead: urgent === undefined ? '' : `Commence par ${urgent.title}.`,
    action: 'Voir l’urgence',
    foldTitle: 'L’agent fonctionne normalement',
  };
}

/** Past 10 min a fan waits too long: his line says so in amber (DASH-11), as the fold counts him. */
const LATE_MINUTES = 10;

function todoOf(todo: DashboardTodo, timeZone: string): Todo {
  return {
    id: todo.id,
    tone: todo.tone,
    kind: KIND_LABEL[todo.kind],
    title: todo.title,
    why: todo.why,
    waiting: `depuis ${lengthOf(todo.waitingMinutes * 60_000)}`,
    late: todo.waitingMinutes > LATE_MINUTES,
    at: `Reçu à ${clockAt(todo.at, timeZone)}`,
    // Every line is handled in Suivi, on its conversation: a draft is decided there, a handoff given back there.
    conversationId: todo.conversationId,
  };
}

function fanOf(fan: DashboardFan, now: Date): Fan {
  return {
    id: fan.id,
    name: fan.name,
    conversationId: fan.conversationId,
    // Short enough for a phone's line (DASH-27).
    line: `depuis ${since(fan.firstSeenAt, now)}`,
    spent: fan.spent,
    byAgent: fan.byAgent,
  };
}

/** « 27 octobre », « 1er novembre » once `withFirstOfMonth` has read it. */
const ECB_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * How the best fans' dollars were counted (choix de Charles, 28/10): at the last ECB rate known, the one pay keeps,
 * or not at all while none is known. Nothing when no dollar sale falls in the period.
 */
export function usdNote(usdSales: ApiDashboard['usdSales']): string | undefined {
  if (!usdSales.seen) return undefined;
  if (usdSales.rate === null)
    return 'Les ventes en dollars ne sont pas comptées : aucun taux BCE n’est encore connu.';
  // An ECB day is a calendar day: read in UTC, it never shifts by a time zone.
  const day = withFirstOfMonth(ECB_DAY.formatToParts(new Date(`${usdSales.rate.day}T00:00:00Z`)));
  return `Dollars convertis en euros au taux BCE du ${day}.`;
}

/**
 * Who reads the Dashboard: the owner, who holds Réglages; the rest of the team; or the creator, who reads her agent's
 * state only (ADR 0023).
 */
export type DashboardReader = 'owner' | 'team' | 'creator';

/** The server's Dashboard as the screen draws it. `sales` is null: nothing is invented in its place. */
export function fromApi(
  api: ApiDashboard,
  reader: DashboardReader = 'owner',
  viewerZone = readerZone(),
): Dashboard {
  const now = new Date(api.creator.now);
  const timeZone = api.creator.timezone;
  const dollars = usdNote(api.usdSales);
  return {
    creator: {
      name: api.creator.name,
      platform: 'Reveal',
      now: today(api.creator.now, timeZone, viewerZone),
    },
    agent: agentState(api, now, reader),
    todos: api.todos.map((todo) => todoOf(todo, timeZone)),
    sales: null,
    telegram: telegramNightOf(api),
    fans: api.fans.map((fan) => fanOf(fan, now)),
    ...(dollars === undefined ? {} : { usdNote: dollars }),
  };
}
