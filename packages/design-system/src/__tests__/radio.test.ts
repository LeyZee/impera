import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('nv-radio (recette DS-04)', () => {
  it('draws its own face instead of the system radio', () => {
    expect(rule('.nv-radio')).toContain('appearance: none');
  });

  it('keeps a 44px target around its 22px face', () => {
    expect(rule('.nv-radio')).toContain('width: 22px');
    expect(rule('.nv-radio::before')).toContain('inset: -11px');
  });

  it('shows the keyboard focus', () => {
    expect(rule('.nv-radio:focus-visible')).toContain('outline: 2px solid var(--nv-focus)');
  });
});
