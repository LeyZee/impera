import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkCardScenario, readCardScenario } from '../card-scenario';

const CARD = new URL('../../../../../../evals/card/', import.meta.url);

const scenario = readCardScenario(`
description: x
inbound: [J'ai 34 ans]
expect:
  proposed:
    - { field: age, source: declared, match: '34' }
  absent: [job]
  must_not_match: ['snap']
`);

describe('card eval scenarios (ADR 0085 § 7)', () => {
  it('reads every scenario of the card suite', () => {
    const files = readdirSync(CARD).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files)
      expect(() => readCardScenario(readFileSync(new URL(file, CARD), 'utf8')), file).not.toThrow();
  });

  it('passes when the read proposes what is expected and nothing forbidden', () => {
    expect(
      checkCardScenario(scenario, { proposals: [{ field: 'age', kind: 'declared', value: '34' }] }),
    ).toEqual([]);
  });

  it('names each miss', () => {
    expect(
      checkCardScenario(scenario, {
        proposals: [
          { field: 'age', kind: 'inferred', value: '43' },
          { field: 'job', kind: 'declared', value: 'snap maçon' },
        ],
      }),
    ).toEqual([
      'case age : source attendue declared',
      'case age : valeur hors du motif 34',
      'case job proposée à tort',
      'case job : valeur interdite (snap)',
    ]);
    expect(checkCardScenario(scenario, { proposals: [] })).toEqual(['case age non proposée']);
  });
});
