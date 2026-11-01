import { describe, expect, it } from 'vitest';

import { DesireCurveSchema, DesirePointSchema } from './conversations';
import { desireBandOf, desireNow } from './desire';
import { EventBodySchema } from './events';

const NOW = new Date('2026-10-27T21:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

describe('desire score', () => {
  it('names the band of a score at its floors', () => {
    expect([0, 39, 40, 69, 70, 100].map(desireBandOf)).toEqual([
      'neutral',
      'neutral',
      'playful',
      'playful',
      'hot',
      'hot',
    ]);
  });

  it('journals a change of score between 0 and 100, with closed signal names', () => {
    const payload = {
      before: null,
      score: 72,
      signals: ['states_desire', 'suggestive_emoji', 'suggestive_emoji'],
      weightsVersion: 'w1',
    };
    expect(EventBodySchema.safeParse({ type: 'desire_scored', payload }).success).toBe(true);
    for (const wrong of [
      { ...payload, score: 101 },
      { ...payload, score: 7.5 },
      { ...payload, before: -1 },
      { ...payload, signals: ['made_up'] },
      { ...payload, signals: Array.from({ length: 21 }, () => 'roleplay') },
    ]) {
      expect(EventBodySchema.safeParse({ type: 'desire_scored', payload: wrong }).success).toBe(false);
    }
  });
});

describe('desireNow', () => {
  it('halves every 90 minutes without a message of his, computed on read', () => {
    expect(desireNow({ score: 80, at: NOW }, NOW)).toBe(80);
    expect(desireNow({ score: 80, at: minutesAgo(90) }, NOW)).toBe(40);
    expect(desireNow({ score: 80, at: minutesAgo(180) }, NOW)).toBe(20);
    expect(desireNow(undefined, NOW)).toBe(0);
  });

  it('falls toward his floor, never below it, and never raises a score under it', () => {
    expect(desireNow({ score: 80, at: minutesAgo(90) }, NOW, 20)).toBe(50);
    expect(desireNow({ score: 80, at: minutesAgo(24 * 60) }, NOW, 20)).toBe(20);
    expect(desireNow({ score: 10, at: minutesAgo(90) }, NOW, 20)).toBe(10);
  });
});

describe('desire curve', () => {
  const point = { at: '2026-10-27T21:00:00.000Z', before: null, score: 46, signals: ['intent:flirt'] };

  it('takes a first point without a score before it, and closed signals only', () => {
    expect(DesirePointSchema.safeParse(point).success).toBe(true);
    expect(DesirePointSchema.safeParse({ ...point, before: 30 }).success).toBe(true);
    expect(DesirePointSchema.safeParse({ ...point, signals: ['made_up'] }).success).toBe(false);
    expect(DesirePointSchema.safeParse({ ...point, score: 101 }).success).toBe(false);
  });

  it('holds at most 200 points', () => {
    const points = (count: number) => ({ points: Array.from({ length: count }, () => point) });
    expect(DesireCurveSchema.safeParse(points(200)).success).toBe(true);
    expect(DesireCurveSchema.safeParse(points(201)).success).toBe(false);
  });
});
