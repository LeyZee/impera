import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MEMBER_PALETTE, shadeOf } from './palette';

/**
 * The palette against the design system's own tokens, in both themes: lisible on the raised surface, and far, in hue,
 * from every colour that says a state (the brand's red, the urgencies, the warnings, the agent).
 */
const css = readFileSync(
  new URL('../../../../../packages/design-system/src/styles/tokens.css', import.meta.url),
  'utf8',
);

function tokensOf(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return new Map(
    [...body.matchAll(/--(nv-[a-z0-9-]+):\s*(#[0-9a-f]{6});/giu)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

const dark = tokensOf("[data-theme='dark']");
const THEMES = { Nuit: dark, Jour: new Map([...dark, ...tokensOf("[data-theme='light']")]) };

function token(theme: Map<string, string>, name: string): string {
  const value = theme.get(name);
  if (value === undefined) throw new Error(`missing token ${name}`);
  return value;
}

function linear(hex: string): [number, number, number] {
  const channel = (i: number): number => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = linear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The OKLCH hue of a colour, in degrees. */
function hue(hex: string): number {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

function apart(x: number, y: number): number {
  const d = Math.abs(x - y) % 360;
  return Math.min(d, 360 - d);
}

describe('MEMBER_PALETTE', () => {
  it('holds twelve distinct shades, each with a name, written as the contract keeps them', () => {
    expect(MEMBER_PALETTE).toHaveLength(12);
    expect(new Set(MEMBER_PALETTE.map((shade) => shade.hex)).size).toBe(12);
    expect(new Set(MEMBER_PALETTE.map((shade) => shade.name)).size).toBe(12);
    for (const shade of MEMBER_PALETTE) expect(shade.hex).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it.each(Object.entries(THEMES))(
    'reads at 3:1 at least on the raised surface and the ground, in %s',
    (_, theme) => {
      for (const shade of MEMBER_PALETTE) {
        expect(contrast(shade.hex, token(theme, 'nv-surface-raised')), shade.name).toBeGreaterThanOrEqual(3);
        expect(contrast(shade.hex, token(theme, 'nv-abyss')), shade.name).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(Object.entries(THEMES))(
    'keeps 30° of hue away from every colour that says a state, in %s',
    (_, theme) => {
      for (const state of ['nv-neon', 'nv-danger', 'nv-warning', 'nv-agent']) {
        for (const shade of MEMBER_PALETTE) {
          expect(
            apart(hue(shade.hex), hue(token(theme, state))),
            `${shade.name} / ${state}`,
          ).toBeGreaterThanOrEqual(30);
        }
      }
    },
  );

  it('names a palette colour, whatever its case, and nothing for one saved before the palette', () => {
    expect(shadeOf('#0A6FA3')?.name).toBe('Acier');
    expect(shadeOf('#c2410c')).toBeNull();
    expect(shadeOf(null)).toBeNull();
  });
});
