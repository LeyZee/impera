import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./my-persona.css', import.meta.url), 'utf8');

describe('Moi › Persona', () => {
  it('keeps the lines of an answer, never two lists run together (MOD-04)', () => {
    expect(css).toMatch(/\.mp-fields dd \{[^}]*white-space: pre-line;/u);
  });
});
