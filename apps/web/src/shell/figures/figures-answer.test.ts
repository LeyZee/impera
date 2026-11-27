/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * A chart answers and moves (Charles, 21/11): « quand ça concerne les graphiques, il faut vraiment des hovers, des
 * animations ». Two checks hold it. A screen that draws a chart with the design system's geometry wires what the
 * pointer, the finger or the keyboard does on it, or hands the drawing to a shared figure, which does. And each shared
 * figure keeps, in the design system's sheet, its drawing-in and its lit state.
 */
const GEOMETRY = /\b(?:chartPoints|linePath|areaPath|niceTicks|donutArcs|ringDash|funnelSteps)\b/u;
const FROM_SYSTEM = /import\s*\{([^}]*)\}\s*from\s*'@impera\/design-system'/gu;
/** What makes a chart answer: a tip, a lit slice, a pointer handler, or a shared figure that carries them. */
const ANSWERS =
  /\b(?:useFloatingTip|tip\.bind|useLit|onPointer(?:Enter|Move|Down)|onLit)\b|<(?:Donut|Columns)\b/u;

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const SYSTEM = fileURLToPath(
  new URL('../../../../../packages/design-system/src/styles/components.css', import.meta.url),
);

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screens(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

function drawsChart(text: string): boolean {
  return [...text.matchAll(FROM_SYSTEM)].some((match) => GEOMETRY.test(match[1] ?? ''));
}

describe('a chart answers and moves', () => {
  it('wires the pointer on every screen that draws one, or hands it to a shared figure', () => {
    const silent = screens(SRC)
      .filter((path) => !path.includes(join('shell', 'figures')))
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return drawsChart(text) && !ANSWERS.test(text);
      });
    expect(silent.map((path) => path.slice(SRC.length))).toEqual([]);
  });

  it('keeps each shared figure’s drawing-in and its lit state in the design system', () => {
    const sheet = readFileSync(SYSTEM, 'utf8');
    // Every rule written for the selector alone, one after the other.
    const rule = (selector: string): string => {
      const found = sheet.split(`\n${selector} {`).slice(1);
      expect(found.length, selector).toBeGreaterThan(0);
      return found.map((after) => after.slice(0, after.indexOf('}'))).join('\n');
    };
    // Drawn in, never there at once.
    for (const selector of ['.nv-donut__arc', '.nv-col__part', '.nv-meter > span', '.nv-spark']) {
      expect(rule(selector), selector).toMatch(/\banimation:/u);
    }
    // Lit under the pointer, the finger or the keyboard.
    expect(sheet).toContain('.nv-donut.is-lit .nv-donut__arc.is-on');
    expect(sheet).toMatch(/\.nv-col:hover \.nv-col__stack,\s*\.nv-col:focus-visible \.nv-col__stack \{/u);
    expect(sheet).toMatch(/\.nv-breakdown__row:hover/u);
    // And still, for who asked for no motion.
    expect(sheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.nv-spark,\s*\.nv-donut__arc,\s*\.nv-col__part,\s*\.nv-meter > span \{\s*animation: none;/u,
    );
  });
});
