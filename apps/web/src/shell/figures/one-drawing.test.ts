/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * One drawing per kind of figure (Charles, 21/11): the donut, its legend, the key, the meter, the small curve and the
 * columns are the design system's (`nv-donut`, `nv-breakdown`, `nv-key`, `nv-meter`, `nv-spark`, `nv-cols`), drawn by
 * `shell/figures`. The
 * classes they replaced had drifted apart from screen to screen; a screen that writes one again, in a sheet or in its
 * markup, would style nothing or bring a second look back.
 */
const RETIRED =
  /\b(?:ins-(?:ring(?!-card)|legend|keys?\b|spark|meter|col\b|col__|daily__)|mf-(?:donut|kind\b|kind__)|fi-(?:ring(?!-row)|legend__(?:row|key)))/u;

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:css|tsx)$/u.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('the figures every screen shares', () => {
  it('are drawn by the design system’s classes, never by a screen’s own again', () => {
    const offenders = sources(SRC).filter((path) => RETIRED.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => path.slice(SRC.length))).toEqual([]);
  });
});
