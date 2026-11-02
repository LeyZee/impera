import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { statusForCode } from '../server';

/** The modules pay is split into (ADR 0047 § 1): before the split, `payroll` alone exists. */
const PAY_MODULES = ['payroll', 'invoicing', 'contractors', 'accounting'];
const MODULES_DIR = fileURLToPath(new URL('../modules/', import.meta.url));
const CODE =
  /'([a-z0-9]+(?:_[a-z0-9]+)*_(?:not_found|invalid|unauthenticated|forbidden|conflict|gone|unprocessable|limited|unavailable))'/gu;

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourcesOf(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('Équipe › Paie : la référence des codes d’erreur avant et après le découpage (ADR 0047 § 1)', () => {
  it('names the same error codes, with the same HTTP status', async () => {
    const present = new Set(readdirSync(MODULES_DIR));
    const codes = new Set<string>();
    for (const module of PAY_MODULES.filter((name) => present.has(name))) {
      for (const file of sourcesOf(join(MODULES_DIR, module))) {
        for (const match of readFileSync(file, 'utf8').matchAll(CODE))
          if (match[1] !== undefined) codes.add(match[1]);
      }
    }
    const reference = Object.fromEntries([...codes].sort().map((code) => [code, statusForCode(code)]));
    expect(Object.keys(reference).length).toBeGreaterThan(50);
    await expect(`${JSON.stringify(reference, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/payroll-error-codes.json',
    );
  });
});
