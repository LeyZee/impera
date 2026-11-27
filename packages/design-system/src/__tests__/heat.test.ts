import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FIRE_STOPS, fireAt } from '../heat.js';

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');

describe('fireAt', () => {
  it('gives each stop its own colour, cold to burning', () => {
    expect(fireAt(0)).toBe('#6e7e96');
    expect(fireAt(35)).toBe('#f5c542');
    expect(fireAt(65)).toBe('#ffaa28');
    expect(fireAt(100)).toBe('#ff8a00');
  });

  it('blends between two stops and clamps outside 0..100', () => {
    expect(fireAt(50)).toBe('#fab835');
    expect(fireAt(-20)).toBe('#6e7e96');
    expect(fireAt(140)).toBe('#ff8a00');
  });

  it('never goes red: from warm to burning the green part stays high', () => {
    for (let level = 35; level <= 100; level += 5) {
      const green = Number.parseInt(fireAt(level).slice(3, 5), 16);
      expect(green).toBeGreaterThanOrEqual(0x8a);
    }
  });

  it('matches the --nv-fire-* tokens of both themes', () => {
    const names = ['cold', 'warm', 'hot', 'burn'];
    FIRE_STOPS.forEach((stop, index) => {
      const hex = fireAt(stop.at);
      const pattern = new RegExp(`--nv-fire-${names[index] ?? ''}: ${hex};`, 'gu');
      expect(tokens.match(pattern)).toHaveLength(2);
    });
  });
});
