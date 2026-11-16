/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./trophy-case.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
const voirTout = /\.tc-all \{([^}]*)\}/u.exec(phone)?.[1] ?? '';

describe('the case on a phone (recette 16/11, CRE-14)', () => {
  it('gives « Voir tout » a thumb’s target of 44 px', () => {
    expect(voirTout).toMatch(/min-height: 44px/u);
  });

  it('lays a shelf three objects to a row', () => {
    expect(phone).toMatch(/\.tc-place \{\s*width: 33\.33%;/u);
  });
});

describe('the case’s class names', () => {
  it('collide with no other stylesheet of the app: `.tc-slot` belonged to the Telegram channel (16/11)', () => {
    const src = new URL('../../', import.meta.url);
    const classesOf = (text: string): Set<string> =>
      new Set([...text.matchAll(/\.(tc-[\w-]+)/gu)].map((m) => m[1] ?? ''));
    const ours = classesOf(css);
    const others = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.css') && !path.endsWith('trophy-case.css'))
      .flatMap((path) => [...classesOf(readFileSync(new URL(path, src), 'utf8'))]);
    expect(others.filter((name) => ours.has(name))).toEqual([]);
  });
});
