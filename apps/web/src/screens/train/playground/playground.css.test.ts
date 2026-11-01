/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`.
const css = readFileSync(new URL('./playground.css', import.meta.url), 'utf8');

/** The body of the first `@media (max-width: <px>px)` block, braces balanced. */
function mediaBlock(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${String(maxWidth)}px)`);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

/** The declarations of one rule inside a block. */
function rule(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`);
  if (at === -1) return '';
  return block.slice(block.indexOf('{', at) + 1, block.indexOf('}', at));
}

describe('playground layout on a phone (390 px)', () => {
  it('keeps the open « Pourquoi » in the one column, so the conversation keeps its width', () => {
    // At 1180 px the open panel is laid over columns 2 to 4; under 820 px the grid has one column only.
    expect(rule(mediaBlock(1180), ".pg-why[data-open='true']")).toContain('grid-column: 2 / 4');
    const phone = rule(mediaBlock(820), ".pg-why[data-open='true']");
    expect(phone).toContain('grid-column: auto');
    expect(phone).toContain('grid-row: auto');
    expect(phone).toContain('position: static');
  });

  it('names the persona in the header, the bar that names it being hidden (M13)', () => {
    // Wider, the bar says it: the header does not repeat it.
    expect(css).toMatch(/\.pg-top__persona,\s*\.pg-top__btn svg \{\s*display: none;/u);
    const phone = mediaBlock(820);
    expect(phone).toMatch(/\.pg-setup,\s*\.pg-bar \{\s*display: none;/u);
    expect(rule(phone, '.pg-top__t .pg-top__persona')).toContain('display: block');
  });
});
