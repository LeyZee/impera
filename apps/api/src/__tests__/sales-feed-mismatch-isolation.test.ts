import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULES = join(import.meta.dirname, '..', 'modules');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * The automatic check of the sales feed publishes `sales_feed_mismatch` for the owner (CRM-04 b3, Équipe's precision
 * d): pay never reads it, so a mismatch never changes a statement on its own. Neither pay nor the planning names it.
 */
describe('sales_feed_mismatch stays out of pay', () => {
  it('is named by no source of payroll, scheduling, contractors or invoicing', () => {
    const readers = ['payroll', 'scheduling', 'contractors', 'invoicing']
      .flatMap((module) => sources(join(MODULES, module)))
      .filter((path) => readFileSync(path, 'utf8').includes('sales_feed_mismatch'));
    expect(readers).toEqual([]);
  });
});
