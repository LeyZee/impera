import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FIRE_STOPS, fireAt } from '../heat.js';

const tokens = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8');
const components = readFileSync(fileURLToPath(new URL('../styles/components.css', import.meta.url)), 'utf8');

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

describe('the fire without motion', () => {
  // The block that stills the fire: the reduced-motion block that names the sparks.
  const still = [...components.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/gu)].find(
    (found) => found[1]?.includes('.nv-spark-dot') === true,
  );

  it('stills every rule that moves the fire, after it and at its weight (Design 27/11)', () => {
    expect(still).toBeDefined();
    const at = still?.index ?? 0;
    const body = still?.[1] ?? '';
    // Every top-level rule that sets a moving animation on the flame, its core or a spark.
    const moving = [...components.matchAll(/\n([^\n{}@][^{}]*)\{([^{}]*)\}/gu)].filter(
      (rule) => /\banimation: nv-/u.test(rule[2] ?? '') && /nv-flame|nv-spark-dot/u.test(rule[1] ?? ''),
    );
    expect(moving.length).toBeGreaterThanOrEqual(3);
    for (const rule of moving) {
      expect(rule.index, rule[1]).toBeLessThan(at);
      for (const selector of (rule[1] ?? '').split(',').map((part) => part.trim())) {
        expect(body, selector).toContain(selector);
      }
    }
    expect(body).toMatch(/animation: none;/u);
  });

  it('draws no spark at all rather than sparks frozen on screen', () => {
    expect(still?.[1]).toMatch(/\.nv-sparks \{\s*display: none;/u);
  });
});
