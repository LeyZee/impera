/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette visuelle du 16/11 (PIL-08): a curve that draws in grows out of a clip that hides it whole. Without motion the
 * drawing never runs, so the clip must go too, or the chart stays empty. Read from disk: Vitest empties an imported sheet.
 */
const css = readFileSync(new URL('./agency.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

/** The selectors of every rule that starts hidden behind a full clip. */
function clippedAtStart(sheet: string): string[] {
  const found: string[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*clip-path:\s*inset\([^)]*100%[^)]*\)[^{}]*)\}/gu)) {
    const selector = match[1]?.trim();
    if (selector !== undefined && !selector.startsWith('@')) found.push(selector);
  }
  return found;
}

describe('the Dashboard without motion', () => {
  const still = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const unclipped = /([^{}]+)\{\s*clip-path:\s*none;\s*\}/u.exec(still)?.[1] ?? '';

  it('finds the curves that draw in', () => {
    expect(clippedAtStart(css)).toEqual(
      expect.arrayContaining(['.ins-curve__plot svg', '.ins-subs__plot svg']),
    );
  });

  it.each(clippedAtStart(css))('shows %s at once', (selector) => {
    expect(unclipped.split(',').map((part) => part.trim())).toContain(selector);
  });
});
