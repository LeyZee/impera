/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FORGE_LENGTH, FORGE_STRIKE } from './forge-sound';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./rewards.css', import.meta.url), 'utf8');
const forge = css.slice(css.indexOf('.rw-forge__cold,'), css.indexOf('@keyframes rw-forge-cold'));
const reduced = css.slice(
  css.lastIndexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.rw-sounds')),
);

/** Every `animation` of the forge, as [duration, delay] in ms (a delay given as a calc is read at its fixed part). */
const timings = [...forge.matchAll(/animation: [\w-]+ (\d+)ms [^;]*?(\d+)ms/gu)].map((m) => [
  Number(m[1]),
  Number(m[2]),
]);

describe('the forge of a rank (Design, 16/11)', () => {
  it('lights when its sound strikes', () => {
    expect(forge).toMatch(
      new RegExp(`rw-forge-flash \\d+ms [\\w-]+ ${String(FORGE_STRIKE * 1000 - 20)}ms`, 'u'),
    );
  });

  it('flashes in 120 ms at most, and its sound lasts under 2.5 s', () => {
    const flash = /rw-forge-flash (\d+)ms/u.exec(forge);
    expect(Number(flash?.[1])).toBeLessThanOrEqual(120);
    expect(FORGE_LENGTH).toBeLessThan(2.5);
  });

  it('settles within 2.5 s: the last words and « Continuer » start by 1950 ms and rise in 450 ms', () => {
    expect(timings.length).toBeGreaterThan(3);
    for (const [duration = 0, delay = 0] of timings) expect(duration + delay).toBeLessThanOrEqual(2500);
    expect(forge).toMatch(/\.rw-reveal__close \{\s*animation-delay: 1950ms;/u);
  });

  it('moves by transform and opacity only', () => {
    const frames = css.slice(
      css.indexOf('@keyframes rw-forge-cold'),
      css.indexOf('@media (prefers-reduced-motion'),
    );
    const properties = new Set([...frames.matchAll(/^\s+([a-z-]+):/gmu)].map((m) => m[1]));
    expect([...properties].toSorted()).toEqual(['opacity', 'transform']);
  });

  it('with « réduire les animations », fades in 150 ms to the settled picture, nothing else moving', () => {
    expect(reduced).toMatch(/\.rw-reveal \*[^{]*\{\s*animation: none !important;/u);
    expect(reduced).toMatch(/\.rw-reveal \{\s*animation: rw-fade 150ms/u);
  });
});
