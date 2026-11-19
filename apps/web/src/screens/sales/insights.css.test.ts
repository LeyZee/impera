/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * « Qui sont tes fans » draws her fans' figures in the colours of data: the violet (`--nv-agent`) says the AI, and
 * nothing of hers is the AI's (recette visuelle 16/11, CRE-12). Read from disk: Vitest empties an imported sheet.
 */
const css = readFileSync(new URL('./insights.css', import.meta.url), 'utf8');

describe('the colours of « Qui sont tes fans »', () => {
  it('never uses the agent’s violet', () => {
    expect(css).not.toMatch(/--nv-agent\b/u);
  });

  it('heats « Quand ils t’écrivent » in gold, like the other series', () => {
    const cell = css.slice(
      css.indexOf('.fi-heat__cell {'),
      css.indexOf('}', css.indexOf('.fi-heat__cell {')),
    );
    expect(cell).toContain('var(--nv-data-2)');
  });
});
