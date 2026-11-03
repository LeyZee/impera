/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Passe téléphone (CR-01): every control a chatter presses on a phone is 44 px to the finger, even when it looks
 * smaller. A compact control lays a transparent `::after` over itself, as the design system's `.nv-btn--sm` does.
 * Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`.
 */
const sheet = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The declarations of the first rule written exactly `selector {`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return '';
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

const px = (declarations: string, property: string): number | null => {
  const found = new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px;`, 'u').exec(declarations);
  return found === null ? null : Number(found[1]);
};

/** The hit area's added reach, up and down then left and right, from `inset: -a` or `inset: -a -b`. */
function reach(declarations: string): { readonly block: number; readonly inline: number } | null {
  const found = /inset:\s*-(\d+)px(?:\s+-?(\d+)(?:px)?)?;/u.exec(declarations);
  if (found === null) return null;
  const block = Number(found[1]);
  return { block, inline: found[2] === undefined ? block : Number(found[2]) };
}

const TARGET = 44;

const COMPACT = [
  { file: '../scheduling/scheduling.css', selector: '.sc-arrow', what: 'the week’s arrows of Planning' },
  { file: './shell.css', selector: '.nv-subnav__item', what: 'the tabs of Commissions and Moi' },
  {
    file: './shell.css',
    selector: '.nv-appearance__seg .nv-seg__opt',
    what: 'Nuit, Jour, Appareil in Plus',
    // Placed by the design system's segmented control.
    placedBy: {
      file: '../../../../packages/design-system/src/styles/components.css',
      selector: '.nv-seg__opt',
    },
  },
  { file: '../screens/team/team.css', selector: '.tm-close', what: 'the close of a panel' },
] as const satisfies readonly {
  file: string;
  selector: string;
  what: string;
  placedBy?: { file: string; selector: string };
}[];

describe('touch targets on a phone (CR-01)', () => {
  it.each(COMPACT)('gives $what a 44 px hit area', (target) => {
    const { file, selector } = target;
    const css = sheet(file);
    const seen = rule(css, selector);
    const height = px(seen, 'height');
    expect(height).not.toBeNull();
    // The hit area is placed against the control itself.
    const placed = 'placedBy' in target ? rule(sheet(target.placedBy.file), target.placedBy.selector) : seen;
    expect(placed).toContain('position: relative');
    const area = rule(css, `${selector}::after`);
    expect(area).toContain("content: ''");
    expect(area).toContain('position: absolute');
    const added = reach(area);
    expect(added).not.toBeNull();
    expect((height ?? 0) + 2 * (added?.block ?? 0)).toBeGreaterThanOrEqual(TARGET);
    const width = px(seen, 'width');
    if (width !== null) expect(width + 2 * (added?.inline ?? 0)).toBeGreaterThanOrEqual(TARGET);
  });

  it('opens a fold of the file 44 px tall', () => {
    const fold = rule(sheet('../contractors/contractors.css'), '.cf-guide > summary,\n.cf-older > summary');
    // 12 px above and below a 21 px line of footnote text.
    expect(fold).toContain('padding-block: var(--nv-space-3)');
  });

  it('keeps « Aller au contenu » out of sight under an iPhone’s status bar until the keyboard reaches it', () => {
    const skip = rule(sheet('./shell.css'), '.nv-skip');
    expect(skip).toContain('top: calc(12px + env(safe-area-inset-top, 0px))');
    // Pushed up by its own height, its margin, and the safe area it was moved down by.
    expect(skip).toContain('transform: translateY(calc(-100% - 24px - env(safe-area-inset-top, 0px)))');
  });

  it.each([
    {
      file: '../screens/team/team.css',
      selector: '.tm-scrim',
      what: 'a panel (congé, échange, rapport, relevé)',
    },
    {
      file: '../settings/services/services.css',
      selector: '.sv-scrim',
      what: 'the confirmation by password',
    },
  ])('keeps $what under an iPhone’s status bar, never behind it', ({ file, selector }) => {
    const scrim = rule(sheet(file), selector);
    expect(scrim).toMatch(
      /padding: calc\((?:var\(--nv-space-4\)|16px) \+ env\(safe-area-inset-top, 0px\)\)/u,
    );
    expect(scrim).toContain('env(safe-area-inset-bottom, 0px)');
  });

  it('scrolls a field into view clear of the clock and the tab bar, on a phone', () => {
    const css = sheet('./shell.css');
    const phone = css.slice(css.indexOf('@media (max-width: 820px) {'));
    const root = rule(phone, ':root:has(.nv-app)');
    expect(root).toContain('scroll-padding-top: calc(8px + env(safe-area-inset-top, 0px))');
    expect(root).toContain('scroll-padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px))');
    // The same room the stage keeps for the tab bar.
    expect(rule(phone, '.nv-app')).toContain(
      '--nv-tabbar-room: calc(110px + env(safe-area-inset-bottom, 0px))',
    );
  });
});
