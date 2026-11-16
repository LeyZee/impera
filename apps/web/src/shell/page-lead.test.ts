/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette visuelle 16/11 (COH-01): a section with tabs writes a lead on every one of its tabs, so the two lines kept
 * for it are never empty on one tab and full on the next. Read from the sources: the rule is about every screen, the
 * ones to come included.
 */
const SRC = new URL('../', import.meta.url);

/** The headers whose tabs all go without a lead: the title names what is open, each panel says the rest. */
const WITHOUT_LEAD: readonly string[] = ['creators/CreatorsPage.tsx'];

/** Each `<PageHeader … />` of a source, cut at its own closing: a `/>` inside a prop's braces is not it. */
const headersOf = (source: string): string[] => {
  const found: string[] = [];
  let from = source.indexOf('<PageHeader');
  while (from !== -1) {
    let depth = 0;
    let at = from;
    for (; at < source.length; at += 1) {
      const char = source[at];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (depth === 0 && char === '/' && source[at + 1] === '>') break;
    }
    found.push(source.slice(from, at));
    from = source.indexOf('<PageHeader', at);
  }
  return found;
};

const screens: readonly (readonly [string, string])[] = readdirSync(SRC, {
  recursive: true,
  encoding: 'utf8',
})
  .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx') && !WITHOUT_LEAD.includes(path))
  .map((path) => [path, readFileSync(new URL(path, SRC), 'utf8')] as const);

describe('the lead of a section with tabs', () => {
  it('is written on every tab: no header takes tabs without a lead', () => {
    const bare = screens.flatMap(([path, source]) =>
      headersOf(source)
        .filter((header) => /\btabs=/u.test(header) && !/\blead[=}]|\{\.\.\./u.test(header))
        .map(() => path),
    );
    expect(bare).toEqual([]);
  });

  it('finds the headers it reads', () => {
    expect(screens.flatMap(([, source]) => headersOf(source)).length).toBeGreaterThan(30);
  });
});
