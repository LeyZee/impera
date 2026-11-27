import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

describe('nv-chip', () => {
  it('keeps a checked chip filled under the pointer, and lightens none under a finger', () => {
    // Every hover rule of a chip leaves the checked ones out: a hover is more specific than `[aria-checked]`.
    const hovers = css.match(/^[^{}\n]*\.nv-chip:hover[^{]*\{/gmu) ?? [];
    expect(hovers.length).toBeGreaterThan(0);
    for (const rule of hovers) {
      expect(rule).toContain("[aria-checked='true']");
      expect(rule).toContain("[aria-pressed='true']");
    }
    // And only where a pointer hovers: on a phone the hover sticks after the tap.
    const start = css.indexOf('@media (hover: hover)');
    expect(start).toBeGreaterThan(-1);
    expect(css.indexOf('.nv-chip:hover', start)).toBeGreaterThan(start);
    expect(css.slice(0, start)).not.toContain('.nv-chip:hover');
  });
});

describe('nv-tag--tint', () => {
  it('takes its colour from --_c for the fill and the dot, and keeps its words in ink', () => {
    const rule = /\.nv-tag--tint \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('var(--_c');
    expect(rule).toContain('16%');
    expect(rule).toContain('color: var(--nv-ink);');
    const dot = /\.nv-tag--tint::before \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(dot).toContain('background: var(--_c');
  });
});

describe('nv-tag--lg', () => {
  it('is the larger information pill: its own height token, footnote text, a 7 px dot when tinted', () => {
    const rule = /\.nv-tag--lg \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('min-height: var(--nv-pill-info-lg);');
    expect(rule).toContain('font-size: var(--nv-text-footnote);');
    const dot = /\.nv-tag--lg\.nv-tag--tint::before \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(dot).toContain('width: 7px;');
  });
});

describe('nv-note', () => {
  it('keeps its words in ink and tints its ground with the tone, without a side bar', () => {
    const rule = /\.nv-note \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('color: var(--nv-ink);');
    expect(rule).not.toMatch(/border-(left|inline-start)/u);
    expect(css).toMatch(
      /\.nv-note--warn,\s*\.nv-note--danger \{\s*background: color-mix\(in srgb, var\(--_c\) 12%, transparent\);/u,
    );
  });
});

describe('nv-tile', () => {
  it('sits on its own ground token, visible on a plate in both themes', () => {
    const rule = /\n\.nv-tile \{([^}]*background[^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toContain('background: var(--nv-tile-fill);');
  });
});
