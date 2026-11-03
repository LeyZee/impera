import { readFileSync } from 'node:fs';

import { SCRIPT_COLOR_PRESETS } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

/** The colour a version written before ADR 0064 took, and a version written without one: the « Rouge » preset. */
describe('the default script colour', () => {
  it('is the « Rouge » preset, in the schema and in migration 0095', () => {
    const rouge = SCRIPT_COLOR_PRESETS.find((preset) => preset.key === 'rouge');
    expect(rouge).toBeDefined();
    const literal = `'${JSON.stringify(rouge?.color)}'::jsonb`;
    const migration = readFileSync(new URL('../migrations/0095_script_colour.sql', import.meta.url), 'utf8');
    const schema = readFileSync(new URL('./schema/scripts.ts', import.meta.url), 'utf8');
    expect(migration).toContain(`DEFAULT ${literal} NOT NULL`);
    expect(schema).toContain(literal);
  });
});
