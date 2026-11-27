/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: the steps are the page's own constant, not exported. */
const page = readFileSync(new URL('./InstallPage.tsx', import.meta.url), 'utf8');
const steps = page.slice(page.indexOf('const STEPS'), page.indexOf('export function InstallPage'));

describe('the install steps (Design, 27/11)', () => {
  it('never leave a guillemet or a colon alone at the end of a line', () => {
    expect(steps).toContain('Choisis «\\u00a0Sur l’écran d’accueil\\u00a0»');
    expect(steps).not.toMatch(/« | »| :/u);
  });
});
