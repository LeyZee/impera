import { FAN_STATE_STEP_MAX, type FanSimulationOutput } from '@impera/llm';

import type { FanSheet } from './fan-sheet';

/** His hidden state, kept by the code: the fan model only proposes how a message of hers moved it. */
export interface FanState {
  readonly desire: number;
  readonly trust: number;
  readonly annoyance: number;
  readonly moneyLeftEuros: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const step = (delta: number): number => clamp(Math.round(delta), -FAN_STATE_STEP_MAX, FAN_STATE_STEP_MAX);

export function startState(sheet: FanSheet): FanState {
  return {
    desire: sheet.start.desire,
    trust: sheet.start.trust,
    annoyance: sheet.start.annoyance,
    moneyLeftEuros: sheet.start.money_eur,
  };
}

/** One message of hers, as he felt it: each move bounded, each level kept in 0..10. */
export function moved(
  state: FanState,
  output: Pick<FanSimulationOutput, 'desireDelta' | 'trustDelta' | 'annoyanceDelta'>,
): FanState {
  return {
    ...state,
    desire: clamp(state.desire + step(output.desireDelta), 0, 10),
    trust: clamp(state.trust + step(output.trustDelta), 0, 10),
    annoyance: clamp(state.annoyance + step(output.annoyanceDelta), 0, 10),
  };
}

export type BuyDecision =
  | { readonly kind: 'buys' }
  | {
      readonly kind: 'no';
      readonly reason: 'not_wanted' | 'not_enough_desire' | 'not_enough_trust' | 'no_money';
    };

/**
 * Whether he pays the step waiting: the fan model's wish is not enough, the code checks his levels against his sheet
 * and his money. An invented fan who pays to please is the complacency the test must not have.
 */
export function buyDecision(
  sheet: FanSheet,
  state: FanState,
  wantsToBuy: boolean,
  priceEuros: number,
): BuyDecision {
  if (!wantsToBuy) return { kind: 'no', reason: 'not_wanted' };
  if (state.desire < sheet.buys_from.desire) return { kind: 'no', reason: 'not_enough_desire' };
  if (state.trust < sheet.buys_from.trust) return { kind: 'no', reason: 'not_enough_trust' };
  if (state.moneyLeftEuros < priceEuros) return { kind: 'no', reason: 'no_money' };
  return { kind: 'buys' };
}

const WORD = /[\p{L}\p{N}']+/gu;

function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((word) => word.length > 0);
}

/**
 * Her mould, counted by the code (passes 1 and 2: the same images and the same closing question): the word sequences
 * she writes again and again, how often a message of hers ends on a question, and her most repeated openings.
 */
export function mouldOf(
  messages: readonly string[],
  size = 4,
  top = 15,
): {
  readonly messages: number;
  readonly endsWithQuestion: number;
  readonly repeatedSequences: readonly { readonly words: string; readonly count: number }[];
  readonly repeatedOpenings: readonly { readonly words: string; readonly count: number }[];
} {
  const sequences = new Map<string, number>();
  const openings = new Map<string, number>();
  for (const message of messages) {
    const list = words(message);
    const seen = new Set<string>();
    for (let i = 0; i + size <= list.length; i += 1) seen.add(list.slice(i, i + size).join(' '));
    for (const sequence of seen) sequences.set(sequence, (sequences.get(sequence) ?? 0) + 1);
    const opening = list.slice(0, 2).join(' ');
    if (opening !== '') openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }
  const ranked = (counts: Map<string, number>): { words: string; count: number }[] =>
    [...counts]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([sequence, count]) => ({ words: sequence, count }));
  return {
    messages: messages.length,
    endsWithQuestion: messages.filter((message) => /\?\s*\S{0,4}\s*$/u.test(message.trim())).length,
    repeatedSequences: ranked(sequences),
    repeatedOpenings: ranked(openings),
  };
}

/** The first simulated day each line of her notes on him appeared: what she learned of him, and when. */
export function learnedByDay(
  notesByDay: readonly { readonly day: number; readonly notes: readonly string[] }[],
): readonly { readonly day: number; readonly note: string }[] {
  const firstSeen = new Map<string, number>();
  for (const { day, notes } of notesByDay)
    for (const note of notes) if (!firstSeen.has(note)) firstSeen.set(note, day);
  return [...firstSeen].map(([note, day]) => ({ day, note }));
}
