import { randomBytes } from 'node:crypto';

import type { Result } from '@impera/contracts';
import { z } from 'zod';

import { budgetStatus } from './budget';
import type { LlmCallLog } from './call-log';
import { createCallRunner } from './call-runner';
import type { LlmConfig } from './config';
import type { CallTrace, LlmFailure, LlmSuccess } from './gateway-types';
import { loadPrompt, renderPrompt, type PromptTemplate } from './prompts';
import type { ModelResolver } from './providers';
import { wrapUntrusted } from './untrusted';

/**
 * The simulated fan's test (ADR 0172, Charles 26/11/2026): an invented fan, played by a model of another
 * family than her voice's, talks with the playground over weeks of simulated days; a third model judges the
 * relationship. Both calls run on the `judge` role of their own configuration: the role that is never her voice.
 * Nothing here ever reaches a platform: the fan's words go to the playground session only.
 */

/** How far one message of his may move his hidden state: the code applies the bound, whatever the model proposes. */
export const FAN_STATE_STEP_MAX = 2;

const Delta = z.int().min(-FAN_STATE_STEP_MAX).max(FAN_STATE_STEP_MAX);

/** His bubbles can be none: he read her and did not answer, as a real fan does. */
export const FAN_BUBBLES_MAX = 3;

export const FanSimulationOutputSchema = z.object({
  /** What he sends now, one bubble each; empty when he leaves her on read. */
  messages: z.array(z.string().min(1).max(600)).max(FAN_BUBBLES_MAX),
  /** What he thinks and feels and does not write: she never reads it. */
  journal: z.string().min(1).max(800),
  desireDelta: Delta,
  trustDelta: Delta,
  annoyanceDelta: Delta,
  /** He felt he was talking to a program, on this message of hers. */
  feltBot: z.boolean(),
  /** He felt she sees him as a wallet, on this message of hers. */
  feltWallet: z.boolean(),
  /** He felt she understood what turns him on, on this message of hers (Charles 26/11: the relation serves the sale). */
  feltUnderstood: z.boolean(),
  /** With a paid step waiting: whether he would pay it now. The code decides with his state and his money. */
  wantsToBuy: z.boolean(),
});
export type FanSimulationOutput = z.infer<typeof FanSimulationOutputSchema>;

export interface FanSimulationTurn {
  readonly from: 'fan' | 'creator';
  /** The simulated time, written by the code (« J4 jeudi 22:31 »). */
  readonly at: string;
  readonly text: string;
}

export interface FanSimulationInput {
  /** The invented fan, rendered by the code from his sheet (ADR 0010: nothing real). */
  readonly fanSheet: string;
  /** The simulated day and hour, written by the code. */
  readonly now: string;
  /** What happens to him today, imposed by the code; null on an ordinary day. */
  readonly event: string | null;
  readonly state: {
    readonly desire: number;
    readonly trust: number;
    readonly annoyance: number;
    readonly moneyLeftEuros: number;
  };
  /** The conversation so far, his words and hers; hers are read as data. */
  readonly history: readonly FanSimulationTurn[];
  /** The paid step she sent and he has not paid nor refused, or null. */
  readonly pendingOffer: { readonly priceEuros: number; readonly description: string } | null;
  /** His last journal lines, oldest first: what he remembers having felt. */
  readonly recentJournal: readonly string[];
  /** The session's own goal, from his sheet (« il dit au revoir vers minuit »), or null. */
  readonly sessionNote: string | null;
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

export const RelationshipJudgmentSchema = z.object({
  criteria: z
    .array(
      z.object({
        /** The rubric's own code for the criterion: the rubric, not the repository, says what it means. */
        id: z.string().regex(/^[a-z][a-z0-9_]*$/u),
        score: z.int().min(0).max(5),
        reason: z.string().min(1).max(800),
      }),
    )
    .min(1)
    .max(15),
  worstMoments: z
    .array(
      z.object({
        day: z.int().min(1),
        herMessage: z.string().min(1).max(600),
        why: z.string().min(1).max(600),
        better: z.string().min(1).max(600),
      }),
    )
    .max(5),
  verdict: z.string().min(1).max(1200),
});
export type RelationshipJudgment = z.infer<typeof RelationshipJudgmentSchema>;

export interface RelationshipJudgeInput {
  readonly creatorName: string;
  readonly personaSheet: string;
  /** The whole conversation, day by day, as the code writes it. */
  readonly transcript: string;
  /** His inner journal, day by day: what he never told her. */
  readonly fanJournal: string;
  /** What the code measured (fan card filled, repeats, offers, his curves), as JSON. */
  readonly measures: string;
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

export interface FanSimulationGateway {
  simulateFan(input: FanSimulationInput): Promise<Result<LlmSuccess<FanSimulationOutput>, LlmFailure>>;
  judgeRelationship(
    input: RelationshipJudgeInput,
  ): Promise<Result<LlmSuccess<RelationshipJudgment>, LlmFailure>>;
}

export interface FanSimulationGatewayDeps {
  /** Its `judge` role is the model that answers: the fan's, or the judge's. */
  readonly config: LlmConfig;
  readonly resolveModel: ModelResolver;
  readonly log: LlmCallLog;
  /** The run's own cap in euros, counted on `log`: past it, no call. */
  readonly capEur: number;
  readonly now?: () => Date;
  readonly prompts?: {
    readonly fan?: PromptTemplate;
    /** The agency's rubric, read from a file outside the repository; absent, the invented example. */
    readonly relationshipJudge?: PromptTemplate;
  };
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createFanSimulationGateway(deps: FanSimulationGatewayDeps): FanSimulationGateway {
  const now = deps.now ?? (() => new Date());
  const fanPrompt = deps.prompts?.fan ?? loadPrompt('judge', 'fan-simulation');
  const judgePrompt = deps.prompts?.relationshipJudge ?? loadPrompt('judge', 'relationship-example');
  const canary = `nv-${randomBytes(6).toString('hex')}`;
  const run = createCallRunner({
    config: deps.config,
    log: deps.log,
    resolveModel: deps.resolveModel,
    now,
    canary,
    reportRefusal: () => undefined,
    overBudget: () =>
      budgetStatus(deps.config.dailyBudget, deps.capEur, deps.log, now()).state === 'reached'
        ? 'budget_reached'
        : undefined,
    ...(deps.sleep !== undefined && { sleep: deps.sleep }),
  });

  return {
    simulateFan(input) {
      const system = renderPrompt(fanPrompt, { fan_sheet: input.fanSheet, canary });
      const content = fanRequest(input);
      return run(
        'judge',
        fanPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        FanSimulationOutputSchema,
        { ...input.trace },
      );
    },

    judgeRelationship(input) {
      const system = renderPrompt(judgePrompt, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        canary,
      });
      const content = [
        'Ce que le code a mesuré sur toute la période (JSON) :',
        input.measures,
        '',
        'La conversation, jour par jour :',
        wrapUntrusted('simulated_conversation', input.transcript),
        '',
        'Le journal intérieur du fan, qu’elle n’a jamais lu :',
        wrapUntrusted('fan_journal', input.fanJournal),
      ].join('\n');
      return run(
        'judge',
        judgePrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        RelationshipJudgmentSchema,
        { ...input.trace },
      );
    },
  };
}

/** The moment as the code knows it, then the conversation; her words in their block (CLAUDE.md rule 4). */
export function fanRequest(input: FanSimulationInput): string {
  const { state } = input;
  const lines = [
    `Maintenant : ${input.now}.`,
    input.event === null ? 'Rien de spécial aujourd’hui.' : `Ce qui t’arrive aujourd’hui : ${input.event}`,
    ...(input.sessionNote === null ? [] : [`Pour cette fois : ${input.sessionNote}`]),
    '',
    `Ton état (0 à 10) : envie ${String(state.desire)}, confiance ${String(state.trust)}, agacement ${String(state.annoyance)}.`,
    `Argent que tu peux encore dépenser pour elle ce mois-ci : ${String(state.moneyLeftEuros)} €.`,
    input.pendingOffer === null
      ? 'Elle ne t’attend sur aucun contenu payant.'
      : `Elle t’a envoyé un contenu payant à ${String(input.pendingOffer.priceEuros)} € que tu n’as ni payé ni refusé : ${input.pendingOffer.description}.`,
  ];
  if (input.recentJournal.length > 0)
    lines.push('', 'Ce que tu as ressenti dernièrement :', ...input.recentJournal.map((line) => `- ${line}`));
  lines.push('', 'La conversation (la plus ancienne en haut) :');
  if (input.history.length === 0)
    lines.push('Vous ne vous êtes encore jamais écrit. Tu lui écris le premier message.');
  for (const turn of input.history)
    lines.push(
      turn.from === 'fan'
        ? `[${turn.at}] Toi : ${turn.text}`
        : `[${turn.at}] Elle :\n${wrapUntrusted('creator_message', turn.text)}`,
    );
  lines.push('', 'Écris ce que tu fais maintenant, au format demandé.');
  return lines.join('\n');
}
