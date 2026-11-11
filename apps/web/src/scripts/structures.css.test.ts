/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties an imported sheet. */
const css = readFileSync(new URL('./structures.css', import.meta.url), 'utf8');

describe('the fields of a stage, no control of the system (ADM-16)', () => {
  it('hides the browser’s arrows of « Durée »', () => {
    expect(css).toMatch(
      /\.st-seconds::-webkit-inner-spin-button,\s*\.st-seconds::-webkit-outer-spin-button \{[^}]*-webkit-appearance: none;/u,
    );
    expect(css).toMatch(/\.st-seconds \{[^}]*appearance: textfield;/u);
  });

  it('grows a sentence with its text, without the handle', () => {
    expect(css).toMatch(/\.ps-area__input\.st-area \{[^}]*resize: none;[^}]*field-sizing: content;/u);
  });
});
