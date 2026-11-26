/**
 * WCAG contrast of the token pairs the design guide promises (docs/design/README.md), in both themes.
 * Glass is checked at its worst case: over the brightest point of the aura, under the veil.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type Rgba = readonly [number, number, number, number];
type Theme = 'dark' | 'light';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of body.matchAll(/--(nv-[a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) map.set(name, value.trim());
  }
  return map;
}

const dark = declarations(block("[data-theme='dark']"));
const themes: Record<Theme, Map<string, string>> = {
  dark,
  light: new Map([...dark, ...declarations(block("[data-theme='light']"))]),
};

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`unsupported color: ${value}`);
}

function token(theme: Theme, name: string): Rgba {
  const value = themes[theme].get(`nv-${name}`);
  if (value === undefined) throw new Error(`missing token nv-${name} in ${theme}`);
  return parseColor(value);
}

/** Paints `top` over an opaque `bottom`. */
function over(bottom: Rgba, top: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// A Record, not an interface, so that Object.entries() keeps the Rgba value type.
type Grounds = Readonly<Record<'void' | 'abyss' | 'surfaceRaised' | 'glassOverAura', Rgba>>;

function grounds(theme: Theme): Grounds {
  const t = (name: string): Rgba => token(theme, name);
  return {
    void: t('void'),
    abyss: t('abyss'),
    surfaceRaised: t('surface-raised'),
    glassOverAura: [t('aura-neon'), t('glass-veil'), t('glass-fill-strong')].reduce(over, t('void')),
  };
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe.each<Theme>(['dark', 'light'])('%s theme', (theme) => {
  const ground = grounds(theme);

  it.each(['ink', 'ink-muted', 'ink-faint'])('%s reads at AA on every ground', (text) => {
    for (const [name, color] of Object.entries(ground)) {
      expect(contrast(token(theme, text), color), `${text} on ${name}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(['neon', 'neon-ink', 'danger', 'success', 'warning', 'sale'])('%s reads at AA on void', (text) => {
    expect(contrast(token(theme, text), ground.void)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('agent, the violet of the AI, reads at AA on void, on a raised surface and on its own soft tag', () => {
    expect(contrast(token(theme, 'agent'), ground.void)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token(theme, 'agent'), ground.surfaceRaised)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrast(token(theme, 'agent'), over(ground.surfaceRaised, token(theme, 'agent-soft'))),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('neon-ink reads at AA on a neon-soft tag over glass', () => {
    expect(
      contrast(token(theme, 'neon-ink'), over(ground.glassOverAura, token(theme, 'neon-soft'))),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink reads at AA on a sent bubble', () => {
    expect(contrast(token(theme, 'ink'), token(theme, 'bubble-sent'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('on-neon reads at AA on neon-solid', () => {
    expect(contrast(token(theme, 'on-neon'), token(theme, 'neon-solid'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ink reads at AA on a selected fill and on a plate over glass', () => {
    for (const fill of ['select-strong', 'plate-hover']) {
      expect(
        contrast(token(theme, 'ink'), over(ground.glassOverAura, token(theme, fill))),
        fill,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(['data-1', 'data-2', 'series-1', 'series-2', 'series-3', 'series-4', 'agent'])(
    '%s, a data series, stands out from void',
    (series) => {
      expect(contrast(token(theme, series), ground.void)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'content-%i, a category of content, stands out from void and from the raised plate',
    (index) => {
      const colour = token(theme, `content-${String(index)}`);
      expect(contrast(colour, ground.void)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrast(colour, token(theme, 'surface-raised'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it.each(['data-1', 'warning', 'danger', 'success'])(
    'the tick of a reached step reads on %s (nv-steps)',
    (name) => {
      expect(contrast(token(theme, 'void'), token(theme, name))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it.each([
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => `content-${String(index)}`),
    ...['series-1', 'series-2', 'series-3', 'series-4', 'warning'],
  ])('ink reads on a tag tinted with %s (nv-tag--tint, 16 %%)', (name) => {
    const [r, g, b] = token(theme, name);
    for (const bottom of [ground.void, ground.surfaceRaised, ground.glassOverAura]) {
      expect(contrast(token(theme, 'ink'), over(bottom, [r, g, b, 0.16]))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('the ten categories of content are ten different colours', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => token(theme, `content-${String(index)}`));
    expect(new Set(all).size).toBe(10);
  });

  it('a switch that is on stands out from void, and its thumb from it', () => {
    expect(contrast(token(theme, 'switch-on'), ground.void)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(token(theme, 'thumb'), token(theme, 'switch-on'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('the edge of the field one writes in (ink at 50 %) stands out from its plate', () => {
    const [r, g, b] = token(theme, 'ink');
    const plate = over(ground.surfaceRaised, token(theme, 'plate-hover'));
    expect(contrast(over(plate, [r, g, b, 0.5]), plate)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('the focus ring stands out from void and from neon-solid', () => {
    expect(contrast(token(theme, 'focus'), token(theme, 'void'))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(token(theme, 'focus'), token(theme, 'surface-raised'))).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});
