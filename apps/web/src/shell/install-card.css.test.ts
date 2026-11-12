/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8');

describe('the install card on a phone (recette 11/11, SOC-14)', () => {
  it('heads the page, in its flow, instead of floating over it', () => {
    expect(css).toMatch(
      /@media \(max-width: 820px\) \{[^@]*\.nv-install\.nv-glass \{\s*position: relative;/u,
    );
    expect(shell).toMatch(
      /<main className="nv-stage"[\s\S]*<InstallNudge \/>[\s\S]*<Outlet \/>[\s\S]*<\/main>/u,
    );
  });
  it('no longer reserves a floating card’s room under every page', () => {
    expect(css).not.toMatch(/\.nv-app:has\(\.nv-install\)/u);
  });
  it('gives its height back to a fill page, so the composer stays above the tab bar', () => {
    expect(css).toMatch(
      /\.nv-stage:has\(> \.nv-install\) \.nv-page--fill \{\s*height: calc\([^;]*var\(--nv-install-room, 0px\)\);/u,
    );
  });
});
