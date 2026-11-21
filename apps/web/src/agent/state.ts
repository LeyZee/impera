import { AGENT_PAUSE_MAX_MS, type AgentHoursNow, type AgentMode, type ResumeMode } from '@impera/contracts';

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
   * Her Reveal session expired (REV-05): nothing is read nor sent until it is captured again from the extension, so
   * « IA active » would be false. Absent from a server that does not say it yet.
   */
  readonly sessionExpired?: boolean | undefined;
}

export type AgentStateKind = 'on' | 'out' | 'idle' | 'expired' | 'paused' | 'off' | 'global';

export interface AgentState {
  readonly kind: AgentStateKind;
  /** The state in a few words, the switch's first line. */
  readonly label: string;
  /** When it changes, or what holds, in her clock; `null` when nothing more is to be said. */
  readonly detail: string | null;
  readonly tone: 'ok' | 'calm' | 'warn';
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

export function agentStateOf(input: AgentStateInput, zone: string, now: Date): AgentState {
  if (input.globalStop) {
    return {
      kind: 'global',
      label: 'IA coupée pour toute l’agence',
      detail: 'Un arrêt général est posé : il se lève dans Réglages, pas ici.',
      tone: 'warn',
    };
  }
  if (input.mode === 'stop') {
    if (input.pausedUntil !== null) {
      return {
        kind: 'paused',
        label: 'IA en pause',
        detail: `reprend seule ${whenOf(input.pausedUntil, zone, now)}, en ${MODE_LABEL[input.resumesAs]}`,
        tone: 'warn',
      };
    }
    return { kind: 'off', label: 'IA coupée', detail: 'jusqu’à ce qu’on la rallume', tone: 'warn' };
  }
  if (input.sessionExpired === true) {
    return {
      kind: 'expired',
      label: 'Session Reveal expirée',
      detail: 'reconnecte-la depuis l’extension : rien n’est lu ni envoyé d’ici là',
      tone: 'warn',
    };
  }
  if (input.hasActivePersona === false) {
    return {
      kind: 'idle',
      label: 'IA en attente de sa persona',
      detail: 'aucun brouillon tant qu’aucune persona n’est active',
      tone: 'warn',
    };
  }
  const mode = MODE_LABEL[input.mode];
  if (input.hoursNow !== null && !input.hoursNow.open) {
    return {
      kind: 'out',
      label: 'IA hors de ses heures',
      detail:
        input.hoursNow.changesAt === null
          ? 'aucune heure ouverte cette semaine'
          : `reprend ${whenOf(input.hoursNow.changesAt, zone, now)}, en ${mode}`,
      tone: 'calm',
    };
  }
  return {
    kind: 'on',
    label: `IA active · ${mode}`,
    detail: input.hoursNow?.changesAt == null ? null : untilWords(input.hoursNow.changesAt, zone, now),
    tone: 'ok',
  };
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
