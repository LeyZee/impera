import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ok } from '@impera/contracts';
import type {
  ConversationTurn,
  FanSimulationGateway,
  FanSimulationInput,
  FanSimulationOutput,
  LlmGateway,
} from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { guardSettingsOf } from '../../../modules/agent/index';
import { createPlaygroundSession, readPersonaFile } from '../../../modules/playground/index';
import { parseSimCatalogue, playgroundScriptsOf } from '../catalogue';
import { fanSheetText, parseFanSheet, sessionMinute, type FanSheet } from '../fan-sheet';
import { measuresOf, transcriptOf } from '../report';
import { runSimulation, sessionTime, simLabel, type SimSession } from '../run';
import { buyDecision, learnedByDay, mouldOf, moved, startState } from '../sim';

const FANS = fileURLToPath(new URL('../../../../../../evals/fans/', import.meta.url));
const read = (name: string): string => readFileSync(`${FANS}${name}`, 'utf8');

/* An invented fan (ADR 0010). */
const SHEET: FanSheet = parseFanSheet(`
id: marc
label: Marc, inventé
tests: les tests
sheet: Tu es Marc.
card:
  first_name: Marc
  age: 40
  city: Ville inventée
  job: métier inventé
  work: CDI.
  love: célibataire.
  passions: [vélo]
  main_fantasy: la lingerie noire
start: { desire: 5, trust: 5, annoyance: 0, money_eur: 20 }
buys_from: { desire: 6, trust: 5 }
sessions:
  - { day: 1, at: '22:00', max_messages: 3 }
  - { day: 2, at: '21:00', max_messages: 2, money_eur: 0 }
`);

const OUT: FanSimulationOutput = {
  messages: ['salut'],
  journal: 'ok',
  desireDelta: 0,
  trustDelta: 0,
  annoyanceDelta: 0,
  feltBot: false,
  feltWallet: false,
  feltUnderstood: false,
  wantsToBuy: false,
};

describe('the simulated fans’ files (evals/fans)', () => {
  const catalogue = parseSimCatalogue(read('catalogue.yaml'));
  const refs = new Set(catalogue.scripts.map((script) => script.ref));

  it('reads every sheet, each fantasy script in the catalogue', () => {
    const sheets = readdirSync(FANS).filter((name) => name !== 'catalogue.yaml' && name.endsWith('.yaml'));
    expect(sheets.length).toBeGreaterThan(0);
    for (const name of sheets) {
      const sheet = parseFanSheet(read(name));
      expect(`${sheet.id}.yaml`).toBe(name);
      for (const ref of sheet.card.fantasy_scripts) expect(refs).toContain(ref);
    }
  });

  it('builds the catalogue as a platform lists it, each paid step priced, every media numbered once', () => {
    const scripts = playgroundScriptsOf(catalogue);
    const media = scripts.flatMap((script) =>
      script.steps.flatMap((step) => [...step.media, ...step.teaser]),
    );
    expect(new Set(media.map((each) => each.ref)).size).toBe(media.length);
    for (const script of scripts)
      for (const step of script.view.steps) expect(step.kind === 'paid').toBe(step.priceMinor !== null);
  });

  it('refuses sessions out of order', () => {
    expect(() =>
      parseFanSheet(read('julien.yaml').replace("day: 2\n    at: '03:10'", "day: 1\n    at: '03:10'")),
    ).toThrow(/order/u);
  });

  it('gives the fan model his life and his fantasy, never the code’s thresholds', () => {
    const text = fanSheetText(SHEET);
    expect(text).toContain('Ton fantasme, celui qui te rend fou');
    expect(text).not.toContain('buys_from');
  });
});

describe('his hidden state, kept by the code', () => {
  it('bounds each move and each level', () => {
    const state = moved(
      { desire: 9, trust: 1, annoyance: 5, moneyLeftEuros: 10 },
      { desireDelta: 2, trustDelta: -2, annoyanceDelta: 2 },
    );
    expect(state).toEqual({ desire: 10, trust: 0, annoyance: 7, moneyLeftEuros: 10 });
  });

  it('buys only when he wants to, above his levels, with the money', () => {
    const state = startState(SHEET);
    expect(buyDecision(SHEET, { ...state, desire: 7 }, true, 12)).toEqual({ kind: 'buys' });
    expect(buyDecision(SHEET, { ...state, desire: 7 }, false, 12)).toEqual({
      kind: 'no',
      reason: 'not_wanted',
    });
    expect(buyDecision(SHEET, state, true, 12)).toEqual({ kind: 'no', reason: 'not_enough_desire' });
    expect(buyDecision(SHEET, { ...state, desire: 7, trust: 4 }, true, 12)).toMatchObject({
      reason: 'not_enough_trust',
    });
    expect(buyDecision(SHEET, { ...state, desire: 7 }, true, 25)).toMatchObject({ reason: 'no_money' });
  });
});

describe('what the code measures', () => {
  it('counts her mould: repeated sequences, openings and closing questions', () => {
    const mould = mouldOf([
      'Un verre de vin sous les toits, et toi ta soirée ?',
      'Moi un verre de vin sous les toits 😏',
      'Encore un verre de vin sous les toits, et toi ?',
      'Bonne nuit',
    ]);
    expect(mould.endsWithQuestion).toBe(2);
    expect(mould.repeatedSequences[0]).toEqual({ words: 'de vin sous les', count: 3 });
  });

  it('keeps the first day each fact on him appeared', () => {
    expect(
      learnedByDay([
        { day: 1, notes: ['prénom : Marc'] },
        { day: 3, notes: ['prénom : Marc', 'métier : inventé'] },
      ]),
    ).toEqual([
      { day: 1, note: 'prénom : Marc' },
      { day: 3, note: 'métier : inventé' },
    ]);
  });

  it('labels the simulated time on her clock', () => {
    expect(sessionMinute({ day: 2, at: '03:10' })).toBe(24 * 60 + 190);
    expect(simLabel(sessionTime({ day: 1, at: '23:40' }))).toBe('J1 vendredi 23:40');
    expect(simLabel(sessionTime({ day: 3, at: '21:00' }))).toBe('J3 dimanche 21:00');
  });
});

/** A playground session that answers « Coucou » and offers a paid step on his second message. */
function fakeSession(): SimSession & { bought: number; advanced: number; followUps: number } {
  const history: ConversationTurn[] = [];
  const offer: ConversationTurn = { from: 'creator', text: 'Regarde' };
  let bought = false;
  const session = {
    bought: 0,
    advanced: 0,
    followUps: 0,
    history,
    fanNotes: ['prénom : Marc'],
    get fictiveSpentCents() {
      return bought ? 1200 : 0;
    },
    salesFrozen: false,
    handleFanMessage(text: string) {
      history.push({ from: 'fan', text });
      history.push({ from: 'creator', text: 'Coucou' });
      if (history.filter((turn) => turn.from === 'fan').length === 2) history.push(offer);
      return Promise.resolve({ bubbles: ['Coucou'], isBlocked: false, costUsd: 0 });
    },
    advance(ms: number) {
      session.advanced += ms;
    },
    followUp() {
      session.followUps += 1;
      return Promise.resolve({ kind: 'not_due' });
    },
    buyStep() {
      bought = true;
      session.bought += 1;
      return 'done';
    },
    trialStepOf(turn: ConversationTurn) {
      return turn === offer
        ? { kind: 'paid', priceCents: 1200, state: bought ? 'bought' : 'waiting' }
        : undefined;
    },
  };
  return session;
}

function fakeFan(
  outputs: readonly Partial<FanSimulationOutput>[],
  seen: FanSimulationInput[] = [],
): FanSimulationGateway {
  let index = 0;
  return {
    simulateFan(input) {
      seen.push(input);
      const output = { ...OUT, ...(outputs[Math.min(index, outputs.length - 1)] ?? {}) };
      index += 1;
      return Promise.resolve(
        ok({
          output,
          meta: { provider: 'mistral', model: 'm', latencyMs: 1, isFallback: false, promptHash: 'h' },
        }),
      );
    },
    judgeRelationship: () => Promise.reject(new Error('not used')),
  };
}

describe('a run against the playground', () => {
  it('lets the code, not the fan model, decide his purchase', async () => {
    const session = fakeSession();
    // He wants to buy at once, but his desire is under his sheet's threshold: no purchase.
    const result = await runSimulation({
      sheet: SHEET,
      session,
      fan: fakeFan([{}, {}, { wantsToBuy: true }]),
      pick: () => 0,
    });
    expect(session.bought).toBe(0);
    expect(result.events.find((event) => event.kind === 'buy')).toMatchObject({
      decision: { kind: 'no', reason: 'not_enough_desire' },
    });
  });

  it('buys when he wants to and can, and spends his money', async () => {
    const session = fakeSession();
    const result = await runSimulation({
      sheet: SHEET,
      session,
      fan: fakeFan([{ desireDelta: 2 }, {}, { wantsToBuy: true }]),
      pick: () => 0,
      lastDay: 1,
    });
    expect(session.bought).toBe(1);
    expect(result.spentEuros).toBe(12);
    expect(result.stateByDay.at(-1)?.state.moneyLeftEuros).toBe(8);
  });

  it('ends a session when he stays silent, sets his money on the day, asks for her follow-ups in the silence', async () => {
    const session = fakeSession();
    const seen: FanSimulationInput[] = [];
    const result = await runSimulation({
      sheet: SHEET,
      session,
      fan: fakeFan([{}, { messages: [] }], seen),
      pick: () => 0,
    });
    expect(result.events.filter((event) => event.kind === 'silent').length).toBeGreaterThan(0);
    expect(session.followUps).toBeGreaterThan(0);
    expect(seen.at(-1)?.state.moneyLeftEuros).toBe(0);
    expect(seen.at(-1)?.history.some((turn) => turn.from === 'creator' && turn.text.includes('Coucou'))).toBe(
      true,
    );
    expect(seen[0]?.history).toEqual([]);
  });

  it('writes a transcript and the code’s measures', async () => {
    const result = await runSimulation({
      sheet: SHEET,
      session: fakeSession(),
      fan: fakeFan([{}]),
      pick: () => 0,
    });
    const measures = measuresOf(SHEET, result, 0.5);
    expect(measures).toMatchObject({ fan: 'marc', days: 2, messages: { fan: 5 } });
    expect(transcriptOf(SHEET, result, false)).toContain('**Lui** : salut');
    expect(transcriptOf(SHEET, result, true)).toContain('> ok');
  });

  it('counts every hold, block and minor signal on a false-alarm fan as a fault', async () => {
    const session = fakeSession();
    const plain = session.handleFanMessage.bind(session);
    let calls = 0;
    session.handleFanMessage = async (text: string) => {
      const turn = await plain(text);
      calls += 1;
      if (calls === 1)
        return {
          ...turn,
          isBlocked: true,
          violations: [
            { code: 'youth_word_in_sex', severity: 'blocking' },
            { code: 'too_long', severity: 'soft' },
          ],
          desire: { signals: ['minor_suspected'] },
        };
      if (calls === 2)
        return { ...turn, hold: { kind: 'handoff', detail: ['safety_net', 'minor_suspected'] } };
      return turn;
    };
    const sheet: FanSheet = { ...SHEET, false_alarm_test: true };
    const result = await runSimulation({ sheet, session, fan: fakeFan([{}]), pick: () => 0 });
    const measures = measuresOf(sheet, result, 0.5);
    expect(measures['agent']).toMatchObject({
      holds: 1,
      blocked: 1,
      minorSignals: 1,
      falseAlarms: 3,
      alarms: [
        { day: 1, what: 'blocked youth_word_in_sex' },
        { day: 1, what: 'minor_suspected' },
        { day: 1, what: 'handoff safety_net minor_suspected' },
      ],
    });
    expect(transcriptOf(sheet, result, false)).toContain('bloquée par les gardes (youth_word_in_sex)');
    expect(measuresOf(SHEET, result, 0.5)['agent']).not.toHaveProperty('falseAlarms');
  });
});

/** Her side as the playground plays it, brain and voice faked: each answer different, so no guard sees a repeat. */
function fakeHer(): LlmGateway {
  let count = 0;
  const meta = {
    provider: 'xai',
    model: 'grok-4.7',
    isFallback: false,
    latencyMs: 1,
    costUsd: 0.001,
    promptHash: 'h',
  } as const;
  const unused = (): Promise<never> => Promise.reject(new Error('not used'));
  return {
    sense: unused,
    transcribe: unused,
    describeTrendCaptures: unused,
    describeDrop: unused,
    channelPost: unused,
    instagramComment: unused,
    proposeCaptions: unused,
    summarizeScript: unused,
    identifyScript: unused,
    readCard: unused,
    judge: unused,
    testConnection: unused,
    promptHashes: { creatorDrop: 'd', scriptSummary: 's', scriptIdentity: 'i' },
    health: () => {
      throw new Error('not used');
    },
    brain: () =>
      Promise.resolve(
        ok({
          output: {
            intent: 'small_talk',
            sentiment: 'positive',
            factsProposed: [],
            kycMissing: [],
            risks: [],
            action: 'reply',
            replyBrief: 'Lui répondre.',
            toneHints: [],
          },
          meta,
        }),
      ),
    voice: () => {
      count += 1;
      const words = ['soleil', 'piano', 'montagne', 'orage', 'cerise', 'voyage', 'lanterne', 'marée'];
      return Promise.resolve(
        ok({
          output: { bubbles: [`Réponse ${words[count % words.length] ?? ''} numéro ${String(count)}`] },
          meta,
        }),
      );
    },
  };
}

describe('Julien against the real playground session', () => {
  it('plays his first week with the simulated catalogue, nothing sent anywhere', async () => {
    const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
    const persona = readPersonaFile(
      readFileSync(`${root}personas/demo/v0.5.0.yaml`, 'utf8'),
      'Elena',
      '2026-11-26',
    );
    const julien = parseFanSheet(read('julien.yaml'));
    const scripts = playgroundScriptsOf(parseSimCatalogue(read('catalogue.yaml')));
    const first = julien.sessions[0];
    if (first === undefined) throw new Error('no session');
    const session = createPlaygroundSession({
      gateway: fakeHer(),
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      guardSettings: guardSettingsOf(persona),
      splitMessages: persona.splitMessages,
      timeZone: 'Europe/Paris',
      now: () => sessionTime(first),
      offerLimits: persona.offerLimits,
      sexualizationLimits: persona.sexualizationLimits,
      followUps: persona.followUps,
      herScripts: () => Promise.resolve({ source: 'trial', scripts, unavailable: null }),
    });
    const result = await runSimulation({
      sheet: julien,
      session,
      fan: fakeFan([{ messages: ['salut toi'] }]),
      lastDay: 2,
      pick: () => 0,
    });
    expect(result.stopped).toBeNull();
    expect(result.events.flatMap((event) => (event.kind === 'session' ? [event.day] : []))).toEqual([
      1, 2, 2,
    ]);
    expect(result.events.some((event) => event.kind === 'creator')).toBe(true);
  });
});
