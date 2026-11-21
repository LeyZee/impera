import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SERVICE_ROLE_CEILING, SERVICE_ROLE_TOTAL_AT_START } from './service-role-ceiling';

/**
 * The ceiling of ADR 0087 § 5 (lot b, SEC-16). The service role crosses creators: every access through it is one the
 * row policies do not sort, so their number is counted here, unit by unit, from the sources as they are (no build, no
 * database), and compared with `service-role-ceiling.ts`.
 *
 * - A unit that adds an access fails this test. The access goes through `withTenant` or `withMember` with a policy
 *   written for it; when it truly crosses creators (a job over all of them, a table the app role never reads), the
 *   ceiling is raised in the same PR, the task card says why, and the security review reads it.
 * - A unit that removes one fails too, until its ceiling is lowered in the same PR: what was won is kept.
 *
 * Two things are counted: the calls of `withAdmin(`, and the queries sent straight on the service handle
 * (`adminDb.select(…)`, `adminDb.db.execute(…)`…), which are the same access without the door.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..');

/** The code without its comments, which name `withAdmin` freely. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|\s)\/\/.*$/gmu, '$1');

/** Every `.ts` of the API but its tests and their support. */
function sources(): string[] {
  return readdirSync(src, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))
    .filter((file) => !file.split(path.sep).includes('__tests__'))
    .sort();
}

/** The unit a file counts for: its module, its folder outside the modules, or `root` for a file of `src` itself. */
function unitOf(file: string): string {
  const parts = file.split(path.sep);
  if (parts[0] === 'modules' && parts[1] !== undefined) return `modules/${parts[1]}`;
  return parts.length === 1 ? 'root' : (parts[0] ?? 'root');
}

const DOOR = /\bwithAdmin\(/gu;
/** A query sent on the service handle itself, however the handle is reached (`deps.adminDb`, `adminDb.db`). */
const STRAIGHT = /\badminDb(?:\.db)?\s*\.\s*(?:select|insert|update|delete|execute|transaction|query)\b/gu;

function counted(): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of sources()) {
    const code = withoutComments(readFileSync(path.join(src, file), 'utf8'));
    const found = (code.match(DOOR)?.length ?? 0) + (code.match(STRAIGHT)?.length ?? 0);
    if (found > 0) counts.set(unitOf(file), (counts.get(unitOf(file)) ?? 0) + found);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

describe('the service role stops growing (ADR 0087 § 5, SEC-16)', () => {
  it('counts, unit by unit, exactly the accesses the ceiling says', () => {
    expect(
      counted(),
      'an access through the service role was added or removed: see the head of this test for what to do',
    ).toEqual(SERVICE_ROLE_CEILING);
  });

  it('never lets the whole go above what it was when the ceiling was set', () => {
    const total = Object.values(SERVICE_ROLE_CEILING).reduce((sum, count) => sum + count, 0);
    expect(total).toBeLessThanOrEqual(SERVICE_ROLE_TOTAL_AT_START);
  });
});
