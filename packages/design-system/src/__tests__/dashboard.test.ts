import { describe, expect, it } from 'vitest';

import { donutArcs, funnelSteps, ringDash, tipPlacement } from '../index.js';

describe('ringDash', () => {
  it('draws the share of the circumference', () => {
    expect(ringDash(0.5, 10)).toBe('31.42 62.83');
    expect(ringDash(1, 10)).toBe('62.83 62.83');
  });

  it('clamps out-of-range and missing shares instead of drawing past the ring', () => {
    expect(ringDash(1.4, 10)).toBe('62.83 62.83');
    expect(ringDash(-0.2, 10)).toBe('0 62.83');
    expect(ringDash(Number.NaN, 10)).toBe('0 62.83');
  });
});

describe('funnelSteps', () => {
  it('gives each step its width against the first and its pass rate from the step before', () => {
    const { steps } = funnelSteps([200, 150, 60]);
    expect(steps.map((s) => s.width)).toEqual([100, 75, 30]);
    expect(steps.map((s) => s.rate)).toEqual([null, 75, 40]);
    expect(steps.map((s) => s.delta)).toEqual([null, null, null]);
  });

  it('marks the step whose rate fell the most against the previous period', () => {
    const funnel = funnelSteps([100, 80, 40, 30], [100, 85, 68, 34]);
    expect(funnel.steps.map((s) => s.delta)).toEqual([null, -5, -30, 25]);
    expect(funnel.breakIndex).toBe(2);
  });

  it('marks nothing when no rate fell', () => {
    expect(funnelSteps([100, 90], [100, 50]).breakIndex).toBeNull();
  });

  it('says no rate for a step larger than the one before: not the same fans', () => {
    const { steps } = funnelSteps([1, 20, 14, 0]);
    expect(steps.map((s) => s.rate)).toEqual([null, null, 70, 0]);
    expect(steps.map((s) => s.width)).toEqual([100, 100, 100, 0]);
    expect(funnelSteps([0, 3]).steps[1]?.rate).toBeNull();
  });

  it('survives an empty step without dividing by zero', () => {
    const { steps } = funnelSteps([0, 0, 0]);
    expect(steps.map((s) => [s.width, s.rate])).toEqual([
      [0, null],
      [0, 0],
      [0, 0],
    ]);
  });
});

describe('tipPlacement', () => {
  const tip = { width: 200, height: 80 };
  const viewport = { width: 1000, height: 700 };

  it('sits below right of the pointer', () => {
    expect(tipPlacement({ x: 100, y: 100 }, tip, viewport)).toEqual({ left: 114, top: 114 });
  });

  it('flips to the left and above near the right and bottom edges', () => {
    expect(tipPlacement({ x: 900, y: 650 }, tip, viewport)).toEqual({ left: 686, top: 556 });
  });

  it('never leaves the padding of the viewport', () => {
    expect(tipPlacement({ x: 5, y: 5 }, { width: 2000, height: 2000 }, viewport)).toEqual({
      left: 12,
      top: 12,
    });
  });
});

describe('donutArcs', () => {
  it('cuts the ring in arcs that follow each other, clockwise from the top', () => {
    const [first, second] = donutArcs([1, 3], 10, 0);
    const quarter = Math.round(((2 * Math.PI * 10) / 4) * 100) / 100;
    expect(first).toEqual({ dash: `${String(quarter)} 62.83`, offset: 0 });
    expect(second?.offset).toBe(-quarter);
  });

  it('leaves a gap between two arcs, none around an arc alone', () => {
    const whole = Math.round(2 * Math.PI * 10 * 100) / 100;
    expect(donutArcs([100], 10)[0]?.dash).toBe(`${String(whole)} ${String(whole)}`);
    const [half] = donutArcs([50, 50], 10, 2);
    expect(half?.dash.startsWith(String(Math.round((Math.PI * 10 - 2) * 100) / 100))).toBe(true);
  });

  it('draws nothing for an empty whole and counts a negative value for nothing', () => {
    expect(donutArcs([0, 0], 10).map((arc) => arc.dash)).toEqual(['0 62.83', '0 62.83']);
    expect(donutArcs([-5, 10], 10)[1]?.offset).toBe(0);
  });
});
