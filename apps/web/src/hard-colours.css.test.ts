/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * A ratchet on the colours written by hand in apps/web's stylesheets (recette visuelle 16/11, T14, COH-10): a colour
 * belongs to the design system's tokens. No linter is added for it (the lockfile stays as it is): this test counts
 * every `#hex`, `rgb(`, `rgba(`, `hsl(` and `hsla(` outside comments and outside the declaration of a custom property
 * (`--rw-gold: #…` names a colour, as a token does), and fails when the count grows.
 */

/**
 * The count of 17/11/2026, when the ratchet reached main. It can only go down: a sheet cleaned of a colour lowers it in the same change; a new colour
 * goes into a token, never here.
 */
const HARD_COLOURS_TODAY = 84;

const SRC = fileURLToPath(new URL('.', import.meta.url));

const sheets = (): string[] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.css'))
    .sort();

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/giu;

/** The colours a sheet writes by hand, one entry each, as `file: declaration`. */
function hardColoursOf(file: string, css: string): string[] {
  const found: string[] = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  // A declaration runs from after `{`, `}` or `;` to the next `;` or `}`.
  for (const declaration of bare.split(/[{};]/u)) {
    const text = declaration.trim();
    if (text.startsWith('--')) continue;
    for (const match of text.matchAll(COLOUR))
      found.push(`${file}: ${text.split('\n')[0] ?? ''} (${match[0]})`);
  }
  return found;
}

describe('colours written by hand in apps/web (T14, COH-10)', () => {
  it('counts a colour of a declaration, never one of a custom property or a comment', () => {
    const css =
      '.a { color: #fff; /* #000 */ background: rgb(0 0 0 / 0.3); --x: #123456; }\n.b { fill: hsl(0 0% 0%); }';
    expect(hardColoursOf('x.css', css)).toHaveLength(3);
    expect(hardColoursOf('x.css', '.a { color: var(--nv-ink); }')).toEqual([]);
  });

  it('never writes more of them than on 17/11/2026', () => {
    const all = sheets().flatMap((file) => hardColoursOf(file, readFileSync(`${SRC}${file}`, 'utf8')));
    // On failure, the list says where the new ones are.
    expect(all.length, all.join('\n')).toBeLessThanOrEqual(HARD_COLOURS_TODAY);
  });
});
