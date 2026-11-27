import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { areaPath, chartPoints, linePath, nearestIndex, niceTicks } from '../index.js';

const frame = { width: 300, height: 100, padTop: 0 };

describe('chartPoints', () => {
  it('spreads the values over the width, highest at the top', () => {
    expect(chartPoints([0, 50, 100], frame)).toEqual([
      { x: 0, y: 100 },
      { x: 150, y: 50 },
      { x: 300, y: 0 },
    ]);
  });

  it('centres a single value and survives a flat series', () => {
    expect(chartPoints([5], frame)).toEqual([{ x: 150, y: 0 }]);
    expect(chartPoints([0, 0], frame).map((p) => p.y)).toEqual([100, 100]);
  });
});

describe('linePath', () => {
  it('starts at the first point and ends at the last', () => {
    const d = linePath(chartPoints([10, 80, 30, 90], frame));
    expect(d.startsWith('M0,')).toBe(true);
    expect(d.endsWith(' 300,0')).toBe(true);
  });

  it('never overshoots a flat stretch (monotone): control points stay on the plateau', () => {
    const d = linePath(chartPoints([0, 100, 100, 0], frame));
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('returns nothing for an empty series', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([], 100)).toBe('');
  });
});

describe('areaPath', () => {
  it('closes the line down to the baseline', () => {
    expect(areaPath(chartPoints([0, 100], frame), 100).endsWith('L300,100 L0,100 Z')).toBe(true);
  });
});

describe('nearestIndex', () => {
  it('snaps the pointer to the closest point and clamps outside the frame', () => {
    expect(nearestIndex(140, 3, 300)).toBe(1);
    expect(nearestIndex(-20, 3, 300)).toBe(0);
    expect(nearestIndex(900, 3, 300)).toBe(2);
    expect(nearestIndex(10, 1, 300)).toBe(0);
  });
});

describe('niceTicks', () => {
  it('uses round steps up to at least the maximum', () => {
    expect(niceTicks(940)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(0.8)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe('nv-stat sparkline', () => {
  const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

  it('ends its draw on a pattern with no gap, so the line reaches the edge of a tile wider than its viewBox', () => {
    const rule = /\.nv-stat__spark \.nv-draw \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('animation: nv-stat-draw');
    const end = /@keyframes nv-stat-draw \{\s*to \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(end).toContain('stroke-dasharray: 1 0;');
    expect(end).toContain('stroke-dashoffset: 0;');
  });

  it('carries no dash at all without motion', () => {
    const reduced = css.slice(css.lastIndexOf('animation: none !important;'));
    const rule = /\n {2}\.nv-stat__spark \.nv-draw \{([^}]*)\}/u.exec(reduced)?.[1] ?? '';
    expect(rule).toContain('stroke-dasharray: none;');
  });
});
