import { describe, expect, it } from 'vitest';

import {
  DESIRE_WEIGHTS_VERSION,
  desireMoved,
  desireScore,
  measureDesire,
  NO_MEASURE,
  type DesireTurn,
} from '../desire';

const NOW = new Date('2026-10-27T21:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
const turn: DesireTurn = {
  previous: undefined,
  signals: [],
  intent: 'small_talk',
  sentiment: 'neutral',
  measured: NO_MEASURE,
  risks: [],
  ageDisputed: false,
  now: NOW,
};

describe('desireScore', () => {
  it('rises on what heats him up, falls on what cools him down, within 0 and 100', () => {
    const warm = desireScore({ ...turn, signals: ['states_desire', 'body_compliment'], intent: 'flirt' });
    expect(warm).toEqual({
      before: null,
      score: 26,
      signals: ['states_desire', 'body_compliment', 'intent:flirt'],
      weightsVersion: DESIRE_WEIGHTS_VERSION,
    });
    expect(desireScore({ ...turn, previous: { score: 80, at: NOW }, signals: ['busy_now'] })).toMatchObject({
      score: 50,
    });
    expect(desireScore({ ...turn, signals: ['discomfort'] }).score).toBe(0);
    const all = desireScore({
      ...turn,
      previous: { score: 95, at: NOW },
      signals: ['explicit_language', 'states_desire'],
      intent: 'sexting',
      sentiment: 'aroused',
    });
    expect(all.score).toBe(100);
  });

  it('counts each of the brain’s signals once, and ignores any it does not know', () => {
    expect(desireScore({ ...turn, signals: ['roleplay', 'roleplay', 'made_up'] }).signals).toEqual([
      'roleplay',
    ]);
  });

  it('starts from the stored score decayed to now', () => {
    const later = desireScore({
      ...turn,
      previous: { score: 80, at: minutesAgo(90) },
      signals: ['roleplay'],
    });
    expect(later).toMatchObject({ before: 40, score: 50 });
  });

  it('adds what code measures: a long, quick answer, suggestive emojis, several messages', () => {
    const measured = { lengthRatio: 2, replySeconds: 30, suggestiveEmojis: 5, inARow: 3 };
    const read = desireScore({ ...turn, measured });
    expect(read.signals).toEqual([
      'long_reply',
      'quick_reply',
      'suggestive_emoji',
      'suggestive_emoji',
      'suggestive_emoji',
      'several_messages',
    ]);
    expect(read.score).toBe(5 + 4 + 12 + 4);
    const cold = desireScore({
      ...turn,
      previous: { score: 50, at: NOW },
      measured: { lengthRatio: 0.3, replySeconds: 7_200, suggestiveEmojis: 0, inARow: 1 },
    });
    expect(cold).toMatchObject({ score: 42, signals: ['short_reply', 'slow_reply'] });
  });

  it('freezes on a risk that stops any sale, and resets for a possible minor or a disputed age', () => {
    const previous = { score: 60, at: NOW };
    expect(desireScore({ ...turn, previous, signals: ['states_desire'], risks: ['distress'] })).toMatchObject(
      {
        before: 60,
        score: 60,
        signals: ['frozen'],
      },
    );
    expect(desireScore({ ...turn, previous, risks: ['minor_suspected'] })).toMatchObject({
      score: 0,
      signals: ['minor_suspected'],
    });
    expect(desireScore({ ...turn, previous, signals: ['states_desire'], ageDisputed: true })).toMatchObject({
      score: 0,
      signals: ['age_disputed'],
    });
    // A risk that stops nothing counts as usual.
    expect(desireScore({ ...turn, previous, signals: ['roleplay'], risks: ['meet_request'] }).score).toBe(70);
  });

  it('moves nothing on a plain message, nor on a first one that leaves him at 0: no event then', () => {
    const plain = desireScore({ ...turn, previous: { score: 30, at: NOW } });
    expect(plain.score).toBe(plain.before);
    expect(desireMoved(plain)).toBe(false);
    const first = desireScore(turn);
    expect(first).toMatchObject({ before: null, score: 0 });
    expect(desireMoved(first)).toBe(false);
    expect(desireMoved(desireScore({ ...turn, signals: ['roleplay'] }))).toBe(true);
  });
});

describe('measureDesire', () => {
  const fan = (text: string, minutes: number) => ({ fromFan: true, text, at: minutesAgo(minutes) });
  const her = (text: string, minutes: number) => ({ fromFan: false, text, at: minutesAgo(minutes) });

  it('reads his last messages against his earlier ones, and dates his answer from hers', () => {
    const history = [
      fan('salut', 30),
      her('coucou toi', 25),
      fan('ça va', 20),
      her('et toi ?', 10),
      fan('je pense à toi depuis ce matin 🔥🔥', 9),
      fan('😏', 9),
    ];
    expect(measureDesire(history)).toEqual({
      lengthRatio: ('je pense à toi depuis ce matin 🔥🔥'.length + '😏'.length) / 5,
      replySeconds: 60,
      suggestiveEmojis: 3,
      inARow: 2,
    });
  });

  it('measures nothing when her message is the last one, and no ratio without earlier messages of his', () => {
    expect(measureDesire([fan('salut', 5), her('coucou', 1)])).toEqual(NO_MEASURE);
    expect(measureDesire([fan('salut', 5)])).toEqual({
      lengthRatio: null,
      replySeconds: null,
      suggestiveEmojis: 0,
      inARow: 1,
    });
  });
});
