import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * The panel's stylesheet, checked on the rules Design asked for on lot 0141-5 that the DOM tests cannot see: the neon
 * kept for « Bon moment », one line for the moment, the first name's size and the field header's alignment.
 */
const css = readFileSync(new URL('./sidepanel.css', import.meta.url), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('the copilot panel stylesheet (Design 16/11, lot 0141-5)', () => {
  it('fills a met notch in the text colour, and in the green of success under « Bon moment » (Design 21/11)', () => {
    expect(rule(".cp-notch[data-met='true']")).toContain('background: currentColor');
    expect(rule(".cp-notch[data-met='true']")).not.toContain('--nv-neon');
    // The same green under the gesture and in the sale's detail; never the neon, red to Charles.
    const good = rule(
      ".cp-moment[data-verdict='good'] .cp-notch[data-met='true'],\n.cp-condition[data-met='true'] .cp-notch",
    );
    expect(good).toContain('var(--nv-trend-up)');
    expect(good).not.toContain('--nv-neon');
    expect(css).not.toContain("data-verdict='now'");
  });

  it('gives each group of the card its own colour, and the amber to what he does not want (Design 21/11)', () => {
    const colours = (['him', 'about_her', 'intimate', 'limit'] as const).map((tone) =>
      rule(`.cp-field[data-tone='${tone}']`),
    );
    expect(new Set(colours).size).toBe(4);
    expect(rule(".cp-field[data-tone='limit']")).toContain('var(--nv-warning)');
  });

  it('keeps the moment on one line, an ellipsis rather than a wrap', () => {
    const text = rule('.cp-moment__text');
    expect(text).toContain('white-space: nowrap');
    expect(text).toContain('text-overflow: ellipsis');
  });

  it('sets the first name to be read first, and the field source on the label line', () => {
    expect(rule('.cp-ident__name')).toContain('font-size: 2.1em');
    expect(rule('.cp-field__top')).toContain('align-items: center');
  });
});
