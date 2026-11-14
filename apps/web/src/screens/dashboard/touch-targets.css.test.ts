/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette du 11/11 (ADM-22): the Dashboard's and the creator's sheet's compact controls are 44 px to the finger, even
 * when they look smaller, by a transparent `::after` over themselves. Read from disk: Vitest empties an imported sheet.
 */
const sheet = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The declarations of the first rule written exactly `selector {`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return '';
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

/** The added reach up and down, from `inset: -a` or `inset: -a b`. */
const reach = (declarations: string): number | null => {
  const found = /inset:\s*(-?\d+)(?:px)?(?:\s+-?\d+(?:px)?)?;/u.exec(declarations);
  return found === null ? null : -Number(found[1]);
};

const AREAS = [
  { file: './dashboard.css', selector: '.db-mode .nv-seg__opt', seen: 36, what: 'the agent’s mode' },
  { file: './agency/agency.css', selector: '.ins-period .nv-seg__opt', seen: 38, what: 'the periods' },
  {
    file: '../../creators/hours/hours.css',
    selector: '.hr-page .ps-seg .nv-seg__opt',
    seen: 38,
    what: 'the replies',
  },
  {
    file: '../../creators/telegram/telegram-channel.css',
    selector: '.tc-day',
    seen: 32,
    what: 'a channel’s day',
  },
  {
    file: '../../creators/telegram/telegram-channel.css',
    selector: '.tc-slot .ps-entry__remove',
    seen: 22,
    what: 'a channel slot’s ×',
  },
  {
    file: '../../creators/overview/list.css',
    selector: '.cl-card__step',
    seen: 24,
    what: 'a step to set up',
  },
] as const;

describe('touch targets of the Dashboard and the creators (ADM-22)', () => {
  it.each(AREAS)('gives $what a 44 px hit area', ({ file, selector, seen }) => {
    const area = rule(sheet(file), `${selector}::after`);
    const placed = area.includes('position: absolute') || selector.includes('ps-entry__remove');
    expect(placed).toBe(true);
    const added = reach(area);
    expect(added).not.toBeNull();
    expect(seen + 2 * (added ?? 0)).toBeGreaterThanOrEqual(44);
  });

  it('gives a legend row and a column of the chart 44 px on a phone', () => {
    const agency = sheet('./agency/agency.css');
    expect(agency).toMatch(/@media \(max-width: 720px\) \{[^@]*\.ins-legend__row \{\s*min-height: 44px;/u);
    // 33 px wide on a phone's week, 5 px more on each side, over half the 10 px gap.
    expect(rule(agency, '.ins-col::after')).toContain('inset: 0 -5px;');
  });
});
