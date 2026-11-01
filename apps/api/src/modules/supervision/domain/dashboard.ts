import {
  asPercent,
  ConversationIdSchema,
  FanIdSchema,
  LIVE_TARGET,
  liveRate,
  replyOpenedAt,
  type AgentHours,
  type AgentMode,
  type AutomaticGate,
  type LiveRateReading,
  type CreatorId,
  type Dashboard,
  type DashboardPeriod,
  type DashboardTodo,
  type HandoffCause,
  type TodosAcrossCreators,
} from '@nirvana/contracts';

import type {
  DashboardFacts,
  DashboardWindow,
  TelegramReading,
  WaitingConversation,
} from './dashboard-ports';

/** The day's AI budget, every creator together (packages/llm `BudgetStatus`). */
export interface BudgetReading {
  readonly spentEur: number;
  readonly capEur: number;
  readonly alertAtEur: number;
}

const MINUTE_MS = 60_000;

/** Why it waits for a human, and what the agent does meanwhile: one sentence per kind (revue 08, Clarté). */
const WHY: Readonly<Record<WaitingConversation['kind'], string>> = {
  minor: 'Il a peut-être moins de 18 ans. L’agent ne lui écrit plus.',
  non_consent: 'Un message ou un média pose une question de consentement. L’agent ne lui écrit plus.',
  distress: 'Il semble en détresse. L’agent ne lui écrit plus, un humain doit lui répondre.',
  meeting: 'Il veut la rencontrer. L’agent attend qu’un humain réponde.',
  manipulation: 'Il essaie de faire sortir l’agent de son rôle. L’agent attend un humain.',
  guard: 'Une garde a bloqué la réponse. L’agent attend un humain.',
  budget: 'Le plafond IA du jour est atteint. Un chatteur prend le relais.',
  keyword: 'Il a écrit un mot-clé d’alerte. L’agent attend un humain.',
  llm_unavailable: 'Aucun modèle IA n’a répondu. Un chatteur prend le relais.',
  other: 'L’agent a passé la main. Un humain doit lui répondre.',
  custom_alert: 'Une de ses alertes personnalisées a sonné. L’agent attend un humain.',
  identity_doubt: 'Le fan doute que ce soit vraiment elle. Un chatteur en poste lui répond.',
  persona_inactive:
    'Elle n’a pas de persona active : l’agent n’écrit rien. Active une version dans Créatrices › Persona.',
  awaiting_approval: 'Un brouillon attend d’être validé depuis plus de 10 minutes.',
  send_failed: 'Un message n’a pas pu partir. L’agent ne réessaie plus, un humain doit le renvoyer.',
  unanswered: 'Son dernier message attend depuis plus de 30 minutes, sans brouillon ni réponse en cours.',
};

/** A fan the platform gives no name (an empty pseudonym): the same words as Suivi, never an empty title. */
function fanNameOf(name: string): string {
  return name.trim() === '' ? 'Fan sans nom' : name;
}

/** « Sans réponse » after this long with nothing written (P3-11), counted while she may answer. */
const UNANSWERED_AFTER_MINUTES = 30;

/**
 * Since when his last message waits (P3-14), or `null` while it is not yet unanswered: out of her reply slots the net
 * is silent (her hours hold the answer, `reply_deferred`), and its thirty minutes run from the later of his message
 * and her opening, so that the messages of her night do not all fall in at once. The wait shown stays his own, from
 * his message, so that « À traiter » keeps them in the order they wrote. Always open (no setting), nothing changes.
 */
export function unansweredSince(
  lastInboundAt: Date,
  now: Date,
  her: { readonly hours: AgentHours; readonly timeZone: string },
): Date | null {
  const opened = replyOpenedAt(her.hours, her.timeZone, now);
  if (opened === null) return null;
  const counted = opened > lastInboundAt ? opened : lastInboundAt;
  return now.getTime() - counted.getTime() >= UNANSWERED_AFTER_MINUTES * MINUTE_MS ? lastInboundAt : null;
}

/** The dispatcher looks for due polls once a minute: a poll can start that much after it is due. */
const DISPATCH_SECONDS = 60;
/** Polls missed in a row before the screen says Reveal is read late: one can fail or wait, three is a stop. */
const LATE_AFTER_POLLS = 3;

/**
 * Whether Reveal is read late (recette 28/10, G8): the session holds, but the latest of its last read and of the
 * session being set is older than three of the account's polls, each one counted at its longest. A worker stopped or
 * polls failing then show, instead of a green « Connectée », the first day included; a session captured again waits
 * for its first poll before it can be late.
 */
export function revealLate(
  read: { readonly lastReadAt: Date | null; readonly sessionSince: Date | null },
  now: Date,
  pollEverySeconds: number,
): boolean {
  const dates = [read.lastReadAt, read.sessionSince].filter((d): d is Date => d !== null);
  if (dates.length === 0) return false;
  const from = Math.max(...dates.map((d) => d.getTime()));
  const allowedMs = LATE_AFTER_POLLS * (pollEverySeconds + DISPATCH_SECONDS) * 1_000;
  return now.getTime() - from > allowedMs;
}

/**
 * Safety first: a possible minor, consent or distress before everything else. These handoff causes are the grave
 * ones: red in « À traiter », and the only lines it keeps while the agent is on Arrêt.
 */
const GRAVE: ReadonlySet<WaitingConversation['kind']> = new Set(['minor', 'non_consent', 'distress']);

/**
 * « À traiter », the gravest first, then the longest waiting. On Arrêt (choix de Charles, 28/10) it keeps the grave
 * lines only: nothing leaves in her name, the chatters hold the hand in Reveal, but a possible minor, a question of
 * consent or a fan in distress still waits for a human. The other lines come back with the agent.
 */
export function todos(
  waiting: readonly WaitingConversation[],
  now: Date,
  agent: { readonly stopped: boolean } = { stopped: false },
): DashboardTodo[] {
  return waiting
    .filter((w) => !agent.stopped || GRAVE.has(w.kind))
    .sort(
      (a, b) =>
        Number(GRAVE.has(b.kind)) - Number(GRAVE.has(a.kind)) || a.since.getTime() - b.since.getTime(),
    )
    .map((w) => ({
      id: `${w.kind}-${w.conversationId}`,
      tone: GRAVE.has(w.kind) ? 'bad' : 'warn',
      kind: w.kind,
      title: fanNameOf(w.fanName),
      why: WHY[w.kind],
      at: w.since.toISOString(),
      waitingMinutes: Math.max(0, Math.floor((now.getTime() - w.since.getTime()) / MINUTE_MS)),
      conversationId: ConversationIdSchema.parse(w.conversationId),
      fanId: FanIdSchema.parse(w.fanId),
    }));
}

/** One creator's « À traiter », as `todos` gave it. */
export interface CreatorQueue {
  readonly creatorId: CreatorId;
  readonly name: string;
  readonly todos: readonly DashboardTodo[];
}

/** Her « À traiter » as the Dashboard shows it: on Arrêt, the grave lines only (#296). */
export function creatorQueue(creatorId: CreatorId, facts: DashboardFacts, now: Date): CreatorQueue {
  return {
    creatorId,
    name: facts.creator.name,
    todos: todos(facts.waiting, now, { stopped: mode(facts) === 'stop' }),
  };
}

/**
 * « À traiter » of several creators in one list (SUIVI-09): each line names its creator, the gravest first across
 * them all, then the longest waiting; and each creator's count, in the order given (DASH-03).
 */
export function queueAcross(queues: readonly CreatorQueue[]): TodosAcrossCreators {
  const items = queues
    .flatMap((queue) =>
      queue.todos.map((todo) => ({ ...todo, creatorId: queue.creatorId, creatorName: queue.name })),
    )
    .sort(
      (a, b) => Number(b.tone === 'bad') - Number(a.tone === 'bad') || Date.parse(a.at) - Date.parse(b.at),
    );
  return {
    items,
    creators: queues.map((queue) => ({
      creatorId: queue.creatorId,
      name: queue.name,
      todos: queue.todos.length,
      grave: queue.todos.filter((todo) => todo.tone === 'bad').length,
    })),
  };
}

/** Arrêt wins; otherwise Automatique as soon as one conversation runs on its own. */
function mode(facts: DashboardFacts): AgentMode {
  if (facts.switches.global || facts.switches.creator) return 'stop';
  return facts.autoConversations > 0 ? 'auto' : 'copilot';
}

const euros = (minor: number): number => minor / 100;
const cents = (amount: number): number => Math.round(amount * 100) / 100;

function guardsToday(handoffs: DashboardFacts['handoffsToday']): Record<HandoffCause, number> {
  const counts: Record<HandoffCause, number> = {
    minor: 0,
    non_consent: 0,
    distress: 0,
    meeting: 0,
    manipulation: 0,
    guard: 0,
    budget: 0,
    keyword: 0,
    llm_unavailable: 0,
    other: 0,
    custom_alert: 0,
    identity_doubt: 0,
    persona_inactive: 0,
  };
  for (const { cause, count } of handoffs) counts[cause] += count;
  return counts;
}

export interface VoiceHealth {
  readonly ok: boolean;
  readonly keyMissing: boolean;
}

/** The Dashboard of one creator, from the facts of the database and the day's budget. */
export function assembleDashboard(input: {
  readonly creatorId: CreatorId;
  readonly period: DashboardPeriod;
  readonly facts: DashboardFacts;
  readonly window: DashboardWindow;
  readonly budget: BudgetReading;
  /** From the gateway's health: a voice model answers, and whether any key exists for it (main or fallback). */
  readonly voice: VoiceHealth;
  /** Jobs the worker gave up on, hers or of no creator; `null` when unreadable. */
  readonly deadJobs: number | null;
  /** Undefined when Telegram is off. */
  readonly telegram: TelegramReading | undefined;
  /**
   * The server lock of Automatique and the live rate it was decided on, read by `conversations` (ADR 0019): shown
   * as is, never recomputed here.
   */
  readonly automatic: { readonly gate: AutomaticGate; readonly reading: LiveRateReading };
}): Dashboard {
  const { facts, window } = input;
  const { gate, reading } = input.automatic;
  return {
    creator: {
      id: input.creatorId,
      name: facts.creator.name,
      timezone: facts.creator.timezone,
      now: window.now.toISOString(),
    },
    period: input.period,
    mode: mode(facts),
    globalStop: facts.switches.global,
    automatic: { open: gate.open, missing: [...gate.missing] },
    liveRate: {
      rate: asPercent(reading.rate),
      target: LIVE_TARGET * 100,
      decided: reading.decided,
      threeWeeksAgo: asPercent(liveRate(facts.decidedThreeWeeksAgo).rate),
    },
    reveal: {
      connected: facts.reveal.connected,
      lastReadAt: facts.reveal.lastReadAt?.toISOString() ?? null,
      late: facts.reveal.connected && revealLate(facts.reveal, window.now, facts.reveal.pollEverySeconds),
      conversations: facts.reveal.conversations,
    },
    voice: {
      ok: input.voice.ok,
      keyMissing: input.voice.keyMissing,
      medianWriteMs: facts.voice.medianWriteMs === null ? null : Math.round(facts.voice.medianWriteMs),
      outagesLast7d: facts.voice.outageHoursLast7d,
    },
    jobs: { dead: input.deadJobs },
    replies: {
      medianReplyMinutes:
        facts.replies.medianReplyMinutes === null
          ? null
          : Math.round(facts.replies.medianReplyMinutes * 10) / 10,
      fansWaitingOver10Min: facts.replies.fansWaitingOver10Min,
      conversationsOpen: facts.replies.conversationsOpen,
    },
    guards: {
      today: guardsToday(facts.handoffsToday),
      telegramAlertsTonight: input.telegram?.alertsTonight ?? null,
    },
    telegramCoverage:
      input.telegram === undefined ? null : { urgentReachable: input.telegram.urgentReachable },
    budget: {
      spentToday: cents(input.budget.spentEur),
      cap: input.budget.capEur,
      alertAt: input.budget.alertAtEur,
      costPerEuroSold: null,
    },
    todos: todos(facts.waiting, window.now, { stopped: mode(facts) === 'stop' }),
    fans: facts.fans.map((fan) => ({
      id: FanIdSchema.parse(fan.id),
      name: fanNameOf(fan.name),
      conversationId: ConversationIdSchema.parse(fan.conversationId),
      firstSeenAt: fan.firstSeenAt.toISOString(),
      spent: euros(fan.spentMinor),
      byAgent: euros(fan.byAgentMinor),
      notes: [...fan.notes],
      ...(fan.alert !== undefined && { alert: fan.alert }),
    })),
    usdSales: {
      seen: facts.usdSales.seen,
      rate: facts.usdSales.rateDay === null ? null : { day: facts.usdSales.rateDay },
    },
  };
}
