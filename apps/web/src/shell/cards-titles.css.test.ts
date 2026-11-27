/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette visuelle 16/11, lot 2 (T4, T5, T12): cards, section titles and pills, read from the stylesheets and the
 * screens on disk. Every sheet of the app and of the design system is scanned, so a new screen cannot bring back a
 * second radius, a padding of its own, a title in capitals or a fourth pill.
 */
const SRC = new URL('../', import.meta.url);
const DS = new URL('../../../../packages/design-system/src/styles/', import.meta.url);
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const tokens = strip(readFileSync(new URL('tokens.css', DS), 'utf8'));
const components = strip(readFileSync(new URL('components.css', DS), 'utf8'));
const shell = strip(readFileSync(new URL('./shell.css', import.meta.url), 'utf8'));

const appFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' });

/** Every stylesheet: the app's, by its path under src/, then the design system's. */
const sheets: readonly (readonly [string, string])[] = [
  ...appFiles
    .filter((path) => path.endsWith('.css'))
    .map((path) => [path, strip(readFileSync(new URL(path, SRC), 'utf8'))] as const),
  ...['components.css', 'base.css'].map(
    (name) => [`design-system/${name}`, strip(readFileSync(new URL(name, DS), 'utf8'))] as const,
  ),
];

/** The screens' sources, tests left out. */
const screens: readonly (readonly [string, string])[] = appFiles
  .filter((path) => path.endsWith('.tsx') && !path.includes('.test.'))
  .map((path) => [path, readFileSync(new URL(path, SRC), 'utf8')] as const);

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Each innermost rule of a sheet: its selector list and its declarations (a rule inside @media included). */
const rulesOf = (css: string): Rule[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: (match[1] ?? '').trim().replace(/\s+/gu, ' '),
    body: match[2] ?? '',
  }));

const rule = (css: string, selector: string): string =>
  rulesOf(css).find((one) => one.selector === selector)?.body ?? '';

/** A declaration's value in a rule's body, or undefined. */
const valueOf = (body: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'u').exec(body)?.[1]?.trim();

/** The last compound selector of one selector (`.a > .b:hover` gives `.b:hover`). */
const lastCompound = (selector: string): string =>
  selector
    .trim()
    .split(/\s*[>+~]\s*|\s+/u)
    .at(-1) ?? '';

/** Whether a compound is a class, with only states or attributes after it (`.x`, `.x:hover`, `.x[data-a]`). */
const targets = (compound: string, name: string): boolean =>
  new RegExp(
    `^(?:\\.[\\w-]+)*\\.${name}(?![\\w-])(?:\\[[^\\]]*\\]|::?[\\w-]+(?:\\([^)]*\\))?|\\.[\\w-]+)*$`,
    'u',
  ).test(compound);

/** The classes written in a JSX `className`, string literals only (`cn('a b', …)` included). */
const classesIn = (attributes: string): string[] => {
  const value = /className=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/su.exec(attributes)?.[1] ?? '';
  return [...value.matchAll(/['"`]([^'"`]*)['"`]/gu)].flatMap((match) => (match[1] ?? '').split(/\s+/u));
};

describe('one card (T4: COH-03, COH-11, PIL-12, PIL-30, ETA-20, CHA-13)', () => {
  /** The screens' card classes: written beside `nv-plate`, or given to a `Panel`. */
  const cards = new Set<string>();
  for (const [, source] of screens) {
    for (const match of source.matchAll(/(['"`])([^'"`\n]*\bnv-plate\b[^'"`\n]*)\1/gu)) {
      for (const name of (match[2] ?? '').split(/\s+/u)) if (/^[a-z][\w-]*$/u.test(name)) cards.add(name);
    }
    for (const match of source.matchAll(/<Panel\b([^>]*?)>/gsu)) {
      for (const name of classesIn(match[1] ?? '')) if (/^[a-z][\w-]*$/u.test(name)) cards.add(name);
    }
  }
  for (const name of [...cards]) if (name.startsWith('nv-')) cards.delete(name);

  /**
   * Plates whose content is a list of rows, each row carrying the card's inset itself: the plate keeps a thin inset of
   * its own (4 to 8 px) for the rows' tint. A toolbar (the Playground's rating bar, the vault's bar of actions on a
   * selection) is not a card either.
   */
  const LIST_PLATES: ReadonlySet<string> = new Set([
    'ins-creators',
    'ins-rank',
    'ps-versions',
    'db-fans',
    'st-queues__who',
    'st-tile',
    'tm-gone',
    'tm-panel',
    'tr-panel',
    'pg-bar',
    'vp-bar',
  ]);

  /** The rules that style a card class itself (states and modifiers included), in every sheet. */
  const sheetRules = sheets.map(
    ([path, css]) => [path, rulesOf(css).filter((one) => !one.selector.startsWith('@'))] as const,
  );
  const kept = new Map<string, { path: string; rule: Rule }[]>();
  /** Each sheet is parsed once and each card's rules are kept: a scan per card and per test outgrew the time limit. */
  const cardRules = (name: string): { path: string; rule: Rule }[] => {
    const known = kept.get(name);
    if (known !== undefined) return known;
    const rules = sheetRules.flatMap(([path, all]) =>
      all
        .filter((one) => one.selector.includes(name))
        .filter((one) => one.selector.split(',').some((part) => targets(lastCompound(part), name)))
        .map((one) => ({ path, rule: one })),
    );
    kept.set(name, rules);
    return rules;
  };

  /** A card set in a card: an item of a list in it, rounded at 18 (`radius-md`), never at the card's 26. */
  const isItem = (name: string): boolean =>
    cardRules(name).some(({ rule: one }) => /radius:\s*var\(--nv-radius-md\)/u.test(one.body));

  it('are tokens: one padding (20, 16 on a phone), 16 px between cards, 28 between groups', () => {
    expect(tokens).toMatch(/--nv-plate-pad: 20px;/u);
    expect(tokens).toMatch(/@media \(max-width: 720px\) \{\s*:root,\s*:host \{\s*--nv-plate-pad: 16px;/u);
    expect(tokens).toMatch(/--nv-card-gap: 16px;/u);
    expect(tokens).toMatch(/--nv-group-gap: 28px;/u);
  });

  it('have one radius, the plate’s 26: the panel sets none of its own', () => {
    expect(rule(components, '.nv-plate')).toMatch(/--_radius: var\(--nv-radius-lg\);/u);
    expect(rule(shell, '.nv-panel')).not.toMatch(/radius/u);
  });

  it('pad the panel’s head and sections with the token, 16 px between a title and what follows', () => {
    expect(rule(components, '.nv-plate--pad')).toMatch(/padding: var\(--nv-plate-pad\);/u);
    expect(rule(shell, '.nv-panel__head')).toMatch(
      /padding: var\(--nv-plate-pad\) var\(--nv-plate-pad\) var\(--nv-space-4\);/u,
    );
    expect(rule(shell, '.nv-panel__sec')).toMatch(/padding: var\(--nv-space-4\) var\(--nv-plate-pad\);/u);
    expect(rule(shell, '.nv-panel__head + .nv-panel__sec')).toMatch(/padding-top: 0;/u);
  });

  it('find the screens’ cards to guard', () => {
    expect(cards.size).toBeGreaterThan(80);
    for (const name of ['su-card', 'ps-head', 'sc-next', 'ins-lead', 'py-sum']) expect(cards).toContain(name);
  });

  it('round every card at 26 and every item in a card at 18, never 34', () => {
    const found: string[] = [];
    for (const name of cards) {
      for (const { path, rule: one } of cardRules(name)) {
        for (const property of ['--_radius', 'border-radius']) {
          const value = valueOf(one.body, property);
          if (value !== undefined && !['var(--nv-radius-lg)', 'var(--nv-radius-md)'].includes(value)) {
            found.push(`${path}: ${one.selector} { ${property}: ${value} }`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('set no inset of their own beside a card’s token (left and right, every width)', () => {
    const allowed = new Set(['var(--nv-plate-pad)', '0']);
    const found: string[] = [];
    for (const name of cards) {
      if (LIST_PLATES.has(name) || isItem(name)) continue;
      for (const { path, rule: one } of cardRules(name)) {
        const sides: string[] = [];
        const padding = valueOf(one.body, 'padding');
        if (padding !== undefined) {
          const parts = padding.split(/\s+(?![^(]*\))/u);
          const right = parts[1] ?? parts[0] ?? '';
          sides.push(right, parts[3] ?? right);
        }
        for (const property of ['padding-left', 'padding-right', 'padding-inline']) {
          const value = valueOf(one.body, property);
          if (value !== undefined) sides.push(value);
        }
        for (const side of sides) {
          if (!allowed.has(side)) found.push(`${path}: ${one.selector} { padding: ${side} }`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('keep their thin inset only for the lists and the toolbar named above', () => {
    for (const name of LIST_PLATES) expect(cards, name).toContain(name);
  });

  it('stand 16 px apart, groups 28, the Dashboard on the page’s edge (PIL-30)', () => {
    const agency = sheets.find(([path]) => path.endsWith('dashboard/agency/agency.css'))?.[1] ?? '';
    const dashboard = sheets.find(([path]) => path.endsWith('dashboard/dashboard.css'))?.[1] ?? '';
    expect(rule(agency, '.ins-body')).toMatch(/gap: var\(--nv-group-gap\);/u);
    expect(rule(agency, '.ins-tiles')).toMatch(/gap: var\(--nv-card-gap\);/u);
    expect(rule(dashboard, '.db')).toMatch(/gap: var\(--nv-group-gap\);/u);
    expect(rule(dashboard, '.db')).toMatch(/padding: 0 0 32px;/u);
    expect(rule(dashboard, '.db-sect__head')).not.toMatch(/padding/u);
  });

  it('never put a frame around a figure beside the period’s hero, nor around a period of the list (GES-19, GES-20)', () => {
    const pay = sheets.find(([path]) => path.endsWith('payroll/pay.css'))?.[1] ?? '';
    expect(rule(pay, '.py-fig')).not.toMatch(/background|box-shadow|radius|padding/u);
    expect(rule(pay, '.py-period')).toMatch(/background: none;/u);
    expect(rule(pay, '.py-periods > li + li')).toMatch(/border-top: 1px solid var\(--nv-hairline\);/u);
  });
});

describe('section titles (T5: COH-05, GES-07, CRE-10, CRE-14, CHA-07, ETA-22)', () => {
  const TITLE_CLASSES = ['nv-h2', 'nv-h3', 'nv-eyebrow'];

  it('are three classes of the design system: 22/28 and 17/22 in 650, the eyebrow 13/18 600', () => {
    const h2 = rule(components, '.nv-h2');
    expect(h2).toMatch(/font-size: var\(--nv-text-title-2\);/u);
    expect(h2).toMatch(/line-height: var\(--nv-text-title-2-leading\);/u);
    expect(h2).toMatch(/font-weight: 650;/u);
    const h3 = rule(components, '.nv-h3');
    expect(h3).toMatch(/font-size: var\(--nv-text-headline\);/u);
    expect(h3).toMatch(/line-height: var\(--nv-text-headline-leading\);/u);
    expect(h3).toMatch(/font-weight: 650;/u);
    const eyebrow = rule(components, '.nv-eyebrow');
    expect(eyebrow).toMatch(/font-size: var\(--nv-text-footnote\);/u);
    expect(eyebrow).toMatch(/font-weight: 600;/u);
    expect(tokens).toMatch(/--nv-text-title-2: 22px;\s*--nv-text-title-2-leading: 28px;/u);
    expect(tokens).toMatch(/--nv-text-headline: 17px;\s*--nv-text-headline-leading: 22px;/u);
  });

  /**
   * The titles that are not a section's: the reveal of a trophy and the name on the trophy case's stage (Charles's
   * validated mock-ups). Counted per file. An empty state's sentence is `Empty`'s, never an h2 (lot 3, COH-04).
   */
  const NOT_SECTIONS: Readonly<Record<string, number>> = {
    'rewards/RewardReveal.tsx': 1,
    'rewards/case/TrophyCaseView.tsx': 1,
  };

  /** Each h2 and h3 of the screens: its file and its classes. */
  const headings = screens.flatMap(([path, source]) =>
    [...source.matchAll(/<h[23](\s[^>]*?)?>/gsu)].map((match) => ({
      path,
      classes: classesIn(match[1] ?? ''),
    })),
  );

  it('style every h2 and h3 of the screens with one of the three classes', () => {
    const outside: Record<string, number> = {};
    for (const { path, classes } of headings) {
      if (!classes.some((name) => TITLE_CLASSES.includes(name))) outside[path] = (outside[path] ?? 0) + 1;
    }
    expect(outside).toEqual(NOT_SECTIONS);
  });

  it('give Panel’s title the section class', () => {
    const layout = screens.find(([path]) => path === 'shell/layout.tsx')?.[1] ?? '';
    expect(layout).toMatch(/<h2 className="nv-h2">\{title\}<\/h2>/u);
  });

  /** A title's look set on purpose beside its class: an empty state's serif. */
  const KEPT: ReadonlySet<string> = new Set([
    ".ps-title[data-placeholder='true']",
    '.sc-hero--none .sc-hero__title',
  ]);

  it('leave the size, weight and face of a title to its class, in every sheet', () => {
    const titled = new Set(
      headings.flatMap(({ classes }) =>
        classes.some((name) => TITLE_CLASSES.includes(name))
          ? classes.filter((name) => /^[a-z][\w-]*$/u.test(name) && !name.startsWith('nv-'))
          : [],
      ),
    );
    const found: string[] = [];
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (selector.startsWith('@')) continue;
        for (const part of selector.split(',').map((one) => one.trim())) {
          if (KEPT.has(part) || part.includes('::first-letter')) continue;
          const last = lastCompound(part);
          const isTitle = /^h[23](?:[.:[]|$)/u.test(last) || [...titled].some((name) => targets(last, name));
          if (!isTitle) continue;
          for (const property of [
            'font-size',
            'line-height',
            'font-weight',
            'letter-spacing',
            'font-family',
            'font',
            'text-transform',
          ]) {
            if (valueOf(body, property) !== undefined) found.push(`${path}: ${part} { ${property} }`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  /** Capitals that are not a title: a value typed in a field, a colour's hex code, the reveal of a trophy. */
  const CAPITALS_KEPT: ReadonlySet<string> = new Set([
    '.cf-prefix__input',
    '.st-free__hex',
    '.rw-reveal__kicker',
  ]);

  it('are never written in capitals, nor spaced out (sentence case everywhere)', () => {
    const found: string[] = [];
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (valueOf(body, 'text-transform') !== 'uppercase') continue;
        if (
          selector
            .split(',')
            .every((part) => part.includes('::first-letter') || CAPITALS_KEPT.has(part.trim()))
        ) {
          continue;
        }
        found.push(`${path}: ${selector}`);
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * Instrument Serif: the empty states, a spoken line, the trophy's reveal and the name on its stage. A member's rank
   * on their file is that same name, said once (lot « fiche-jeu-hierarchie-2 », validated 16/11).
   */
  const SERIF_KEPT: ReadonlySet<string> = new Set([
    '.nv-calm',
    '.nv-empty__title',
    '.sc-hero--none .sc-hero__title',
    ".ps-title[data-placeholder='true']",
    '.fi-none',
    '.pg-empty__t',
    '.own-quiet em',
    '.ag-reel__quote',
    '.rw-reveal__title',
    '.tc-hero__name',
    '.rw-member__name',
    // The welcome of a first sign-in, a line said to her (maquette validée par Charles le 27/11).
    '.fw__title',
  ]);

  it('keep Instrument Serif for the empty states, never for a title', () => {
    const found: string[] = [];
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (!/--nv-font-serif|Instrument Serif/u.test(body)) continue;
        if (selector.split(',').every((part) => SERIF_KEPT.has(part.trim()))) continue;
        found.push(`${path}: ${selector}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('keep Playfair for the name Impera alone, never on a creator’s initial (COH-09)', () => {
    const found: string[] = [];
    const named = new Set(['.nv-wordmark', '.nv-popup__brand', '.nv-rail__name']);
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (body.includes('--nv-font-wordmark') && !named.has(selector)) found.push(`${path}: ${selector}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('three pills (T12: COH-08, COH-09)', () => {
  it('are three heights: information 22, a choice 32, a counter 18', () => {
    expect(tokens).toMatch(/--nv-pill-info: 22px;/u);
    expect(tokens).toMatch(/--nv-pill-choice: 32px;/u);
    expect(tokens).toMatch(/--nv-pill-count: 18px;/u);
    expect(rule(components, '.nv-status')).toMatch(/height: var\(--nv-pill-info\);/u);
    expect(rule(components, '.nv-tag')).toMatch(/height: var\(--nv-pill-info\);/u);
    expect(rule(components, '.nv-chip')).toMatch(/height: var\(--nv-pill-choice\);/u);
    const count = rule(components, '.nv-count');
    expect(count).toMatch(/height: var\(--nv-pill-count\);/u);
    expect(count).toMatch(/font-size: var\(--nv-text-caption\);/u);
    expect(count).toMatch(/font-weight: 650;/u);
    expect(count).toMatch(/border-radius: var\(--nv-radius-full\);/u);
  });

  /** A day's number in a calendar is a round mark, not a pill. */
  const NOT_PILLS: ReadonlySet<string> = new Set(['.cal-day__num', '.sc-grid__daynum']);

  it('leave no fourth height to a capsule with text, in any sheet', () => {
    const found: string[] = [];
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (!/radius:\s*(?:var\(--nv-radius-full\)|99+px)/u.test(body)) continue;
        if (valueOf(body, 'font-size') === undefined && valueOf(body, 'font') === undefined) continue;
        const height = valueOf(body, 'height') ?? valueOf(body, 'min-height');
        if (height === undefined || !/^\d+(?:\.\d+)?px$/u.test(height)) continue;
        const px = Number.parseFloat(height);
        if (px < 14 || px > 30) continue;
        if (valueOf(body, 'width') === height) continue;
        if (NOT_PILLS.has(selector)) continue;
        found.push(`${path}: ${selector} { height: ${height} }`);
      }
    }
    expect(found).toEqual([]);
  });

  it('count in the tabs with the design system’s counter, not a copy at 10 px', () => {
    expect(rule(shell, '.nv-subnav__count')).not.toMatch(/font-size|height/u);
    const layout = screens.find(([path]) => path === 'shell/layout.tsx')?.[1] ?? '';
    expect(layout).toMatch(/className="nv-count nv-subnav__count"/u);
  });

  it('draw the controls with pictograms, never an emoji (CRE-11)', () => {
    const found: string[] = [];
    for (const [path, source] of screens) {
      for (const match of source.matchAll(/<(button|summary|a|Link)\b[^>]*>([^<]*)/gsu)) {
        if (/\p{Emoji_Presentation}/u.test(match[2] ?? '')) found.push(`${path}: ${(match[2] ?? '').trim()}`);
      }
    }
    expect(found).toEqual([]);
  });
});
