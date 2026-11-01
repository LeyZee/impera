import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PersonaSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { canonicalJson } from '../canonical';

describe('canonicalJson', () => {
  it('sorts keys at every level and keeps the order of lists', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('published personas (P5-01)', () => {
  const hashOf = (path: string): string =>
    createHash('sha256')
      .update(
        canonicalJson(
          PersonaSchema.parse(
            parse(
              readFileSync(
                fileURLToPath(new URL(`../../../../../../../personas/${path}`, import.meta.url)),
                'utf8',
              ),
            ),
          ),
        ),
      )
      .digest('hex');

  it('keep their hash when the schema grows: an absent block adds nothing, no default fills it', () => {
    expect(hashOf('demo/v0.1.0.yaml')).toBe(
      'a2c3ace16a87fed207f0d28ab268463fbf3efccd523da0c1528979115a54eba0',
    );
    expect(hashOf('messalina/v0.0.0.yaml')).toBe(
      '8dfa36dd49d888f60a58855db56aa4df9486c77199816c416351164b8945c200',
    );
  });
});
