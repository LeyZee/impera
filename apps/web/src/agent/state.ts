import {
  AGENT_PAUSE_MAX_MS,
  type AgentHoursNow,
  type AgentMode,
  type AgentStatus,
  type ResumeMode,
} from '@impera/contracts';

import { MODE_LABEL } from './mode';

import { addDays, clockAt, dayOf, zonedInstant } from '@/scheduling/time';

/*
 * Her AI's switch in words (ADR 0148 § 1): « IA active · Copilote, jusqu'à 1 h », « IA hors de ses heures, reprend
 * demain à 9 h », « IA en pause jusqu'à 15 h 29 », « IA coupée », « IA coupée pour toute l'agence ». Pure: the switch
 * lays it out, the tests read it without a browser. A pause or a stop is a state someone chose, never an alarm: amber,
 * the red stays the urgencies'.
 */

/** What the server says of her AI, from the Dashboard or her card in the list. */
export interface AgentStateInput {
  readonly mode: AgentMode;
  readonly globalStop: boolean;
  readonly pausedUntil: string | null;
  readonly hoursNow: AgentHoursNow | null;
  readonly resumesAs: ResumeMode;
  /**
   * Whether a persona is active for her: without one the agent writes nothing, whatever its mode (PRO1-03). Absent
   * when the reader cannot know it (her « Mise en route » is the owner's alone): the mode alone is said then.
   */
  readonly hasActivePersona?: boolean;
  /**
   * The platforms where her session expired (REV-05): nothing is read nor sent there until it is captured again from
   * the extension, so « IA active » would be false. Empty from a server that does not say it yet.
   */
  readonly expiredSessions?: readonly string[] | undefined;
  /**
   * What runs, as the server decided it from her persona, her scripts, her drafts and her mode (recette 27/11, G18):
   * it wins over the fields above. Absent or `null` (the Dashboard, an older server): the state is read from them.
   */
  readonly agentStatus?: AgentStatus | null | undefined;
  /**
   * No model answers the agent now (recette 27/11, A9): `GET /v1/dashboard/todos`'s `aiOutage`, with the clock its hour
   * is said at (`outageZone`, as Suivi's banner and the menu's pill). Every state but an Arrêt says it then.
   */
  readonly aiOutage?: { readonly since: string | null; readonly zone: string } | null | undefined;
}

export type AgentStateKind =
  'on' | 'out' | 'idle' | 'expired' | 'paused' | 'off' | 'global' | 'no_scripts' | 'drafts_off' | 'outage';

export interface AgentState {
  readonly kind: AgentStateKind;
  /** The state in a few words, the switch's first line. */
  readonly label: string;
  /** When it changes, or what holds, in her clock; `null` when nothing more is to be said. */
  readonly detail: string | null;
  /** `bad` for an outage alone: fans wait for a human now, the red of the urgencies. */
  readonly tone: 'ok' | 'calm' | 'warn' | 'bad';
}

/** « demain », « jeudi », or nothing for her today: the day of an instant, in her clock. */
function dayWord(instant: string, zone: string, now: Date): string | null {
  const today = dayOf(now, zone);
  const day = dayOf(instant, zone);
  if (day === today) return null;
  if (day === addDays(today, 1)) return 'demain';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: zone }).format(new Date(instant));
}

/** « à 15 h 29 », « demain à 9 h », « jeudi à 9 h »: an instant in her clock, against her today. */
export function whenOf(instant: string, zone: string, now: Date): string {
  const word = dayWord(instant, zone, now);
  return `${word === null ? '' : `${word} `}à ${clockAt(instant, zone)}`;
}

/** « jusqu’à 1 h », « jusqu’à demain 1 h », « jusqu’à jeudi 9 h ». */
export function untilWords(instant: string, zone: string, now: Date): string {
  const word = dayWord(instant, zone, now);
  return `jusqu’à ${word === null ? '' : `${word} `}${clockAt(instant, zone)}`;
}

/** Her state with what is known of her persona; unknown, the state as the server gave it. */
export function withPersona(input: AgentStateInput, hasActivePersona: boolean | undefined): AgentStateInput {
  return hasActivePersona === undefined ? input : { ...input, hasActivePersona };
}

/** Her state from the fields alone, when the server did not decide it: the same order as `agentStatusOf` (api). */
function statusOf(input: AgentStateInput): AgentStatus {
  if (input.globalStop) return 'global_stop';
  if (input.mode === 'stop') return input.pausedUntil === null ? 'stopped' : 'paused';
  if ((input.expiredSessions?.length ?? 0) > 0) return 'session_expired';
  if (input.hasActivePersona === false) return 'no_persona';
  if (input.hoursNow !== null && !input.hoursNow.open) return 'off_hours';
  return input.mode;
}

export function agentStateOf(input: AgentStateInput, zone: string, now: Date): AgentState {
  const status = input.agentStatus ?? statusOf(input);
  // An outage says itself over what runs, as Suivi's banner and the menu's pill do (A9); an Arrêt someone chose stays.
  const chosenStop = status === 'global_stop' || status === 'paused' || status === 'stopped';
  if (input.aiOutage != null && !chosenStop) {
    const { since, zone: outageZone } = input.aiOutage;
    return {
      kind: 'outage',
      label: 'IA indisponible',
      detail: since === null ? 'un humain répond' : `depuis ${clockAt(since, outageZone)}, un humain répond`,
      tone: 'bad',
    };
  }
  switch (status) {
    case 'global_stop':
      return {
        kind: 'global',
        label: 'IA coupée pour toute l’agence',
        detail: 'Un arrêt général est posé : il se lève dans Réglages, pas ici.',
        tone: 'warn',
      };
    case 'paused':
      return {
        kind: 'paused',
        label: 'IA en pause',
        detail:
          input.pausedUntil === null
            ? `reprend seule, en ${MODE_LABEL[input.resumesAs]}`
            : `reprend seule ${whenOf(input.pausedUntil, zone, now)}, en ${MODE_LABEL[input.resumesAs]}`,
        tone: 'warn',
      };
    case 'stopped':
      return { kind: 'off', label: 'IA coupée', detail: 'jusqu’à ce qu’on la rallume', tone: 'warn' };
    case 'session_expired':
      return {
        kind: 'expired',
        label: 'Session Reveal expirée',
        detail: 'reconnecte-la depuis l’extension : rien n’est lu ni envoyé d’ici là',
        tone: 'warn',
      };
    case 'no_persona':
      return {
        kind: 'idle',
        label: 'IA en attente de sa persona',
        detail: 'aucun brouillon tant qu’aucune persona n’est active',
        tone: 'warn',
      };
    case 'no_scripts':
      return {
        kind: 'no_scripts',
        label: 'IA en attente de scripts',
        detail: 'aucun script prêt dans Reveal : l’agent n’a rien à proposer',
        tone: 'warn',
      };
    case 'off_hours':
      return {
        kind: 'out',
        label: 'IA hors de ses heures',
        detail:
          input.hoursNow?.changesAt == null
            ? 'aucune heure ouverte cette semaine'
            : `reprend ${whenOf(input.hoursNow.changesAt, zone, now)}, en ${MODE_LABEL[input.mode]}`,
        tone: 'calm',
      };
    case 'drafts_off':
      return {
        kind: 'drafts_off',
        label: 'IA prête · brouillons éteints',
        detail: 'les chatteurs écrivent seuls dans Reveal',
        tone: 'calm',
      };
    case 'copilot':
    case 'auto':
      return {
        kind: 'on',
        label: `IA active · ${MODE_LABEL[status]}`,
        detail: input.hoursNow?.changesAt == null ? null : untilWords(input.hoursNow.changesAt, zone, now),
        tone: 'ok',
      };
  }
}

/**
 * The menu's pill in a word or two (recette 27/11, PRO-15): what runs, never a mode the agent does not follow. `null`
 * while it runs in its mode or for an Arrêt, which the pill says by its mode.
 */
export function pillStatusLabel(status: AgentStatus | null | undefined): string | null {
  switch (status) {
    case 'session_expired':
      return 'Session expirée';
    case 'no_persona':
      return 'en attente de persona';
    case 'no_scripts':
      return 'en attente de scripts';
    case 'off_hours':
      return 'hors de ses heures';
    case 'drafts_off':
      return 'brouillons éteints';
    case 'global_stop':
    case 'paused':
    case 'stopped':
    case 'copilot':
    case 'auto':
    case null:
    case undefined:
      return null;
  }
}

/** A pause the switch offers (ADR 0148 § 1): its words, and its end. An Arrêt without an end is « Couper ». */
export interface PauseChoice {
  readonly key: 'hour' | 'morning';
  readonly label: string;
  readonly until: Date;
}

/**
 * 1 h, or until 9:00 tomorrow on her clock, never longer than the server takes. Out of her hours, only a pause that
 * ends after she opens again does something (avis Design, 19/11): `opensAt` leaves out the others; none may be left.
 */
export function pauseChoices(zone: string, now: Date, opensAt: string | null = null): readonly PauseChoice[] {
  const hour = new Date(Math.ceil((now.getTime() + 60 * 60_000) / 60_000) * 60_000);
  const morning = zonedInstant(addDays(dayOf(now, zone), 1), 9 * 60, zone);
  const choices: PauseChoice[] = [
    { key: 'hour', label: `1\u00a0h, ${untilWords(hour.toISOString(), zone, now)}`, until: hour },
  ];
  if (morning.getTime() > hour.getTime() && morning.getTime() - now.getTime() < AGENT_PAUSE_MAX_MS) {
    choices.push({ key: 'morning', label: 'Jusqu’à demain 9\u00a0h', until: morning });
  }
  const opens = opensAt === null ? null : Date.parse(opensAt);
  return opens === null ? choices : choices.filter((choice) => choice.until.getTime() > opens);
}

/**
 * Who may turn her AI on, off or pause it (ADR 0148 § 1, ADR 0024): the owner, and an operator who reads her whole
 * (manager); a chatter never, the creator never sees it. The server checks it again.
 */
export function canSwitch(user: { readonly role: string; readonly teamScope: string | null }): boolean {
  return (
    user.role === 'owner' ||
    (user.role === 'operator' && user.teamScope !== 'self' && user.teamScope !== null)
  );
}
