/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette visuelle 16/11 (COH-01, COH-02, T1, T3): the page's template in the stylesheets. Read from disk: Vitest
 * empties a stylesheet imported as a module, even with `?raw`.
 */
const SRC = new URL('../', import.meta.url);
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const shell = strip(readFileSync(new URL('./shell.css', import.meta.url), 'utf8'));
const tokens = strip(
  readFileSync(new URL('../../../../packages/design-system/src/styles/tokens.css', import.meta.url), 'utf8'),
);

/** Every stylesheet of the app, by its path under src/. */
const sheets: readonly (readonly [string, string])[] = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.css'))
  .map((path) => [path, strip(readFileSync(new URL(path, SRC), 'utf8'))] as const);

/** Each innermost rule of a sheet: its selector list and its declarations (a rule inside @media included). */
const rulesOf = (css: string): { selector: string; body: string }[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }));

const rule = (css: string, selector: string): string =>
  rulesOf(css).find((one) => one.selector === selector)?.body ?? '';

/**
 * The blocks that are a screen's whole column, which once set their own width by hand (COH-02 lists them). The page
 * bounds them now; a new one goes on this list.
 */
const PAGE_BLOCKS = [
  'py-board',
  'py-me',
  'tg-page',
  'sv-page',
  'bk-page',
  'me-prefs',
  'me-profile',
  'ct-sections',
  'ct-skeleton',
  'cr-profile',
  'cr-access',
  'ps-page',
  'su-card',
  'rp-board',
  'rp-rules',
  'sc-today',
  'sc-mine',
  'nv-help-install',
  'nv-notif',
  'cp-page',
] as const;

/**
 * A width that is not the page's but a measure of what is inside, kept on purpose: Commissions with one column only,
 * the other having nothing to say (CHAT-29).
 */
const KEPT: ReadonlySet<string> = new Set([".py-me[data-single='true']"]);

/** The values a page-level block may give its width: the two tokens, or nothing narrower than the page. */
const ALLOWED = new Set([
  'var(--nv-page-wide)',
  'var(--nv-page-narrow)',
  'var(--_page-width)',
  'none',
  '100%',
]);

/** Whether one selector of a list sets the width of a page or of a page-level block. */
function isPageLevel(selector: string): boolean {
  if (/\.nv-page(?![\w-])/u.test(selector)) return true;
  const last = selector.split(/\s*[>+~\s]\s*/u).at(-1) ?? '';
  return PAGE_BLOCKS.some((block) => new RegExp(`\\.${block}(?![\\w-])`, 'u').test(last));
}

describe('the page’s two widths (COH-02)', () => {
  it('are two tokens of the design system', () => {
    expect(tokens).toMatch(/--nv-page-wide: 1128px;/u);
    expect(tokens).toMatch(/--nv-page-narrow: 820px;/u);
  });

  it('bound every block of a page, wide unless the page says narrow', () => {
    expect(rule(shell, '.nv-page')).toMatch(/--_page-width: var\(--nv-page-wide\);/u);
    expect(rule(shell, ".nv-page[data-width='narrow']")).toMatch(/--_page-width: var\(--nv-page-narrow\);/u);
    expect(rule(shell, '.nv-page > *')).toMatch(/max-width: var\(--_page-width\);/u);
  });

  it('are the only widths a page or a page-level block sets', () => {
    const found: string[] = [];
    for (const [path, css] of sheets) {
      for (const { selector, body } of rulesOf(css)) {
        if (selector.startsWith('@')) continue;
        const width = /(?:^|;)\s*max-width:\s*([^;]+);/u.exec(body)?.[1]?.trim();
        if (width === undefined || ALLOWED.has(width)) continue;
        for (const one of selector.split(',').map((part) => part.trim())) {
          if (isPageLevel(one) && !KEPT.has(one)) found.push(`${path}: ${one} { max-width: ${width} }`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('still finds each page-level block it guards in some stylesheet', () => {
    const all = sheets.map(([, css]) => css).join('\n');
    for (const block of PAGE_BLOCKS) expect(all, block).toMatch(new RegExp(`\\.${block}(?![\\w-])`, 'u'));
  });
});

describe('the page’s header (COH-01)', () => {
  it('lays the title block alone on its row, the buttons at its right, the tabs on a row of their own', () => {
    expect(rule(shell, '.nv-page__head')).toMatch(/display: grid;/u);
    expect(rule(shell, '.nv-page__title')).toMatch(/grid-row: 1;[\s\S]*align-self: start;/u);
    expect(rule(shell, '.nv-page__actions')).toMatch(/grid-column: 2;[\s\S]*grid-row: 1;/u);
    const tabs = rule(shell, '.nv-page__tabs');
    expect(tabs).toMatch(/grid-column: 1 \/ -1;/u);
    expect(tabs).toMatch(/grid-row: 2;/u);
    expect(tabs).toMatch(/margin-top: 16px;/u);
  });

  it('keeps the title at one height: the eyebrow’s line kept when empty, a way back held to that line', () => {
    expect(rule(shell, '.nv-page__title:not(:has(> .nv-eyebrow))')).toMatch(/padding-top: 18px;/u);
    expect(rule(shell, '.nv-eyebrow > .nv-btn--plain')).toMatch(
      /margin-block: calc\(\(18px - 34px\) \/ 2\);/u,
    );
  });

  it('keeps two lines for the lead of a section with tabs, so its tabs do not move from one to the next', () => {
    expect(rule(shell, '.nv-page__head[data-tabs] > .nv-page__title:has(> .nv-page__lead)')).toMatch(
      /min-height: calc\(18px \+ 2px \+ var\(--nv-text-large-title-leading\) \+ 6px \+ 2 \* 21px\);/u,
    );
  });

  it('puts the tabs under the title on a phone, before the buttons', () => {
    const phone = shell.slice(shell.indexOf('@media (max-width: 820px) {'));
    expect(rule(phone, '.nv-page__head')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/u);
    expect(rule(phone, '.nv-page__actions')).toMatch(/grid-row: 3;/u);
  });
});

describe('Réglages as a list (recette visuelle 16/11, GES-04)', () => {
  const settings = strip(readFileSync(new URL('../screens/settings/settings.css', import.meta.url), 'utf8'));
  const phone = settings.slice(settings.indexOf('@media (max-width: 820px) {'));

  it('stands the list on the page’s left, the section on its right, groups apart by the group gap', () => {
    const body = rule(settings, '.rgl-body');
    expect(body).toMatch(/grid-template-columns: 220px minmax\(0, 1fr\);/u);
    expect(body).toMatch(/gap: var\(--nv-group-gap\);/u);
  });

  it('gives every line 44 px to the finger, the open one a neutral light', () => {
    expect(rule(settings, '.rgl-list__item')).toMatch(/min-height: 44px;/u);
    expect(rule(settings, ".rgl-list__item[aria-current='page']")).toMatch(
      /background-color: var\(--nv-select-strong\);/u,
    );
    expect(settings).not.toMatch(/--nv-neon/u);
  });

  it('is the screen of Réglages on a phone: the list alone, or a section alone with the way back', () => {
    expect(rule(phone, '.rgl-body')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/u);
    expect(
      rule(phone, '.rgl-body[data-open] > .rgl-list,\n  .rgl-body:not([data-open]) > .rgl-section'),
    ).toMatch(/display: none;/u);
    expect(rule(phone, '.rgl-list__chevron')).toMatch(/display: block;/u);
    expect(rule(phone, '.nv-eyebrow > .rgl-back')).toMatch(/display: inline-flex;/u);
  });
});
