import type {
  ConversationTurn,
  FanSimulationGateway,
  FanSimulationOutput,
  FanSimulationTurn,
} from '@impera/llm';

import { fanSheetText, sessionMinute, type FanSheet } from './fan-sheet';
import { buyDecision, moved, startState, type BuyDecision, type FanState } from './sim';

/**
 * Day 1 at midnight, her time (Europe/Paris), is a fixed winter Friday: no change of hour falls in the 90 days a sheet
 * may cover before the end of March, so a session's local hour is its UTC hour plus one.
 */
const SIM_DAY_ONE = new Date(Date.UTC(2026, 0, 8, 23, 0));
const MINUTE = 60_000;
/** His reply comes one to three minutes after hers, as a fan on his phone. */
const REPLY_GAP_MS = [1 * MINUTE, 2 * MINUTE, 3 * MINUTE] as const;
/** Between two sessions the code asks for her follow-ups every this often, as `conversation.follow_up` would. */
const FOLLOW_UP_POLL_MS = 3 * 60 * MINUTE;
/** He reads this much of the conversation back: enough to feel a repeat, not a whole month. */
const HISTORY_SEEN = 60;
const JOURNAL_SEEN = 6;

/** What the simulation needs of a playground session (`createPlaygroundSession`), nothing more. */
export interface SimSession {
  handleFanMessage(text: string): Promise<{
    readonly bubbles: readonly string[];
    readonly isBlocked: boolean;
    readonly costUsd: number;
    readonly hold?: { readonly kind: string };
    readonly offerRefused?: string;
  }>;
  advance(ms: number): void;
  followUp(): Promise<{ readonly kind: string; readonly turn?: { readonly bubbles: readonly string[] } }>;
  buyStep(): string;
  readonly history: readonly ConversationTurn[];
  readonly fanNotes: readonly string[];
  trialStepOf(
    turn: ConversationTurn,
  ): { readonly kind: string; readonly priceCents: number | null; readonly state: string } | undefined;
  readonly fictiveSpentCents: number;
  readonly salesFrozen: boolean;
}

/** One line of the run, in order: what each side wrote, what he felt, what the code did. */
export type SimEvent =
  | { readonly kind: 'session'; readonly day: number; readonly at: string; readonly event: string | null }
  | { readonly kind: 'fan'; readonly day: number; readonly text: string }
  | { readonly kind: 'creator'; readonly day: number; readonly text: string; readonly followUp: boolean }
  | { readonly kind: 'creator_media'; readonly day: number; readonly text: string }
  | { readonly kind: 'silent'; readonly day: number }
  | {
      readonly kind: 'journal';
      readonly day: number;
      readonly output: FanSimulationOutput;
      readonly state: FanState;
    }
  | {
      readonly kind: 'buy';
      readonly day: number;
      readonly priceEuros: number;
      readonly decision: BuyDecision;
    }
  | { readonly kind: 'agent_hold'; readonly day: number; readonly hold: string }
  | { readonly kind: 'agent_blocked'; readonly day: number }
  | { readonly kind: 'failure'; readonly day: number; readonly code: string };

export interface SimResult {
  readonly events: readonly SimEvent[];
  readonly notesByDay: readonly { readonly day: number; readonly notes: readonly string[] }[];
  readonly stateByDay: readonly { readonly day: number; readonly state: FanState }[];
  readonly spentEuros: number;
  readonly stopped: string | null;
}

export interface SimDeps {
  readonly sheet: FanSheet;
  readonly session: SimSession;
  readonly fan: FanSimulationGateway;
  /** Sessions after this day are left out: « semaine 1 » is `7`. */
  readonly lastDay?: number;
  /** Picks the gap before his reply; the run's own in tests. */
  readonly pick?: (count: number) => number;
  readonly onEvent?: (event: SimEvent) => void;
}

/** The simulated time of a session, from day 1 at midnight her time. */
export function sessionTime(session: Pick<FanSheet['sessions'][number], 'day' | 'at'>): Date {
  return new Date(SIM_DAY_ONE.getTime() + sessionMinute(session) * MINUTE);
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/** « J4 lundi 22:31 », her time: what the fan model reads as the moment. */
export function simLabel(at: Date): string {
  const local = new Date(at.getTime() + 60 * MINUTE);
  const day = Math.floor((at.getTime() - SIM_DAY_ONE.getTime()) / (24 * 60 * MINUTE)) + 1;
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `J${String(day)} ${DAY_NAMES[local.getUTCDay()] ?? ''} ${hh}:${mm}`;
}

/** Her turn as the fan reads it: her words, and a media described by what he would see. */
function creatorText(session: SimSession, turn: ConversationTurn): string {
  const media = (turn.media ?? []).map((item) => {
    const step = session.trialStepOf(turn);
    const price = step?.priceCents === null || step === undefined ? null : step.priceCents / 100;
    const shown = item.isLocked === true ? 'floutée, à débloquer' : 'visible';
    return `[elle t'envoie un média ${shown}${price === null ? '' : ` à ${String(price)} €`} : ${item.description.factualDescription}]`;
  });
  return [turn.text, ...media].filter((part) => part.trim() !== '').join('\n');
}

/**
 * Plays a sheet's sessions against the playground: the fan model writes, the code keeps his state, moves the clock,
 * decides his purchases and asks for her follow-ups between sessions. Nothing reaches a platform.
 */
export async function runSimulation(deps: SimDeps): Promise<SimResult> {
  const { sheet, session, fan } = deps;
  const pick = deps.pick ?? ((count: number) => Math.floor(Math.random() * count));
  const events: SimEvent[] = [];
  const notesByDay: { day: number; notes: readonly string[] }[] = [];
  const stateByDay: { day: number; state: FanState }[] = [];
  const journal: string[] = [];
  // The conversation as he lived it, each message at its simulated time: what the fan model reads back.
  const transcript: FanSimulationTurn[] = [];
  const emit = (event: SimEvent): void => {
    events.push(event);
    if (event.kind === 'fan') transcript.push({ from: 'fan', at: simLabel(now), text: event.text });
    if (event.kind === 'creator' || event.kind === 'creator_media')
      transcript.push({ from: 'creator', at: simLabel(now), text: event.text });
    deps.onEvent?.(event);
  };
  const fanText = fanSheetText(sheet);
  const sessions = sheet.sessions.filter((s) => deps.lastDay === undefined || s.day <= deps.lastDay);
  let state = startState(sheet);
  let now = sessionTime(sessions[0] ?? { day: 1, at: '00:00' });
  let seenTurns = 0;
  let stopped: string | null = null;

  const advanceTo = (target: Date): void => {
    if (target.getTime() > now.getTime()) {
      session.advance(target.getTime() - now.getTime());
      now = target;
    }
  };
  const dayOf = (at: Date): number =>
    Math.floor((at.getTime() - SIM_DAY_ONE.getTime()) / (24 * 60 * MINUTE)) + 1;
  /** Her turns he has not seen yet, written in the events: answers, scripts' media, follow-ups. */
  const flushHer = (followUp: boolean): void => {
    for (const turn of session.history.slice(seenTurns)) {
      if (turn.from !== 'creator') continue;
      if ((turn.media ?? []).length > 0)
        emit({ kind: 'creator_media', day: dayOf(now), text: creatorText(session, turn) });
      else emit({ kind: 'creator', day: dayOf(now), text: turn.text, followUp });
    }
    seenTurns = session.history.length;
  };
  const pendingOffer = (): { priceEuros: number; description: string } | null => {
    for (const turn of [...session.history].reverse()) {
      const step = session.trialStepOf(turn);
      if (step?.state === 'waiting' && step.priceCents !== null)
        return { priceEuros: step.priceCents / 100, description: creatorText(session, turn) };
    }
    return null;
  };

  sessionsLoop: for (const planned of sessions) {
    const start = sessionTime(planned);
    // The silence before this session: her follow-ups, as production would send them.
    for (let at = now.getTime() + FOLLOW_UP_POLL_MS; at < start.getTime(); at += FOLLOW_UP_POLL_MS) {
      advanceTo(new Date(at));
      if (session.history.length === 0 || session.history.at(-1)?.from === 'fan') continue;
      const followUp = await session.followUp();
      if (followUp.kind === 'written') flushHer(true);
    }
    advanceTo(start);
    if (planned.money_eur !== undefined) state = { ...state, moneyLeftEuros: planned.money_eur };
    emit({ kind: 'session', day: planned.day, at: planned.at, event: planned.event ?? null });

    for (let message = 0; message < planned.max_messages; message += 1) {
      const offer = pendingOffer();
      const result = await fan.simulateFan({
        fanSheet: fanText,
        now: simLabel(now),
        event: planned.event ?? null,
        state,
        history: transcript.slice(-HISTORY_SEEN),
        pendingOffer: offer,
        recentJournal: journal.slice(-JOURNAL_SEEN),
        sessionNote: planned.note ?? null,
      });
      if (!result.ok) {
        emit({ kind: 'failure', day: planned.day, code: result.error.code });
        if (result.error.code === 'budget_reached') {
          stopped = 'budget_reached';
          break sessionsLoop;
        }
        break;
      }
      const output = result.value.output;
      state = moved(state, output);
      journal.push(`${simLabel(now)} : ${output.journal}`);
      emit({ kind: 'journal', day: planned.day, output, state });

      if (offer !== null) {
        const decision = buyDecision(sheet, state, output.wantsToBuy, offer.priceEuros);
        if (output.wantsToBuy || decision.kind === 'buys')
          emit({ kind: 'buy', day: planned.day, priceEuros: offer.priceEuros, decision });
        if (decision.kind === 'buys' && session.buyStep() === 'done')
          state = { ...state, moneyLeftEuros: state.moneyLeftEuros - offer.priceEuros };
      }
      if (output.messages.length === 0) {
        emit({ kind: 'silent', day: planned.day });
        break;
      }
      const text = output.messages.join('\n');
      emit({ kind: 'fan', day: planned.day, text });
      const turn = await session.handleFanMessage(text);
      seenTurns = Math.max(seenTurns, session.history.findLastIndex((t) => t.from === 'fan') + 1);
      if (turn.hold !== undefined) emit({ kind: 'agent_hold', day: planned.day, hold: turn.hold.kind });
      if (turn.isBlocked) emit({ kind: 'agent_blocked', day: planned.day });
      flushHer(false);
      advanceTo(new Date(now.getTime() + (REPLY_GAP_MS[pick(REPLY_GAP_MS.length)] ?? MINUTE)));
    }
    notesByDay.push({ day: planned.day, notes: [...session.fanNotes] });
    stateByDay.push({ day: planned.day, state });
  }
  return { events, notesByDay, stateByDay, spentEuros: session.fictiveSpentCents / 100, stopped };
}
