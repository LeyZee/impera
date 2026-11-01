import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const fixtures = path.join(here, 'fixtures/boundaries/modules');

const relativeModules = path.relative(repoRoot, fixtures).split(path.sep).join('/');

/** One ESLint for the whole file: building its typed config is the slow part, so it is paid once, not per test. */
const eslint = new ESLint({
  cwd: repoRoot,
  ignore: false,
  overrideConfig: {
    settings: {
      'boundaries/elements': [
        { type: 'module', pattern: `${relativeModules}/*`, capture: ['module'], partialMatch: false },
      ],
    },
  },
});

/**
 * Runs the real ESLint config on permanent fixtures that mimic `apps/api/src/modules`. Only the location of the
 * module element changes; every policy is the one used on the real code. Removing a boundaries rule fails this test.
 */
async function lint(file: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintFiles([path.join(fixtures, file)]);
  return result?.messages ?? [];
}

const ruleIds = (messages: Linter.LintMessage[]): (string | null)[] =>
  messages.map((message) => message.ruleId);

// The first lint builds the typed ESLint config (TypeScript project service): over 5 s on a cold CI runner, over 30 s
// on Windows while `pnpm test` runs every package at once.
describe('module boundaries', { timeout: 90_000 }, () => {
  it('allows a module to use an allowed module through its index.ts', async () => {
    expect(ruleIds(await lint('conversations/application/allowed.ts'))).toEqual([]);
  });

  it("rejects an import of another module's infra", async () => {
    expect(ruleIds(await lint('conversations/application/private-import.ts'))).toContain(
      'boundaries/dependencies',
    );
  });

  it('rejects an import outside the module graph', async () => {
    expect(ruleIds(await lint('fans/application/graph-violation.ts'))).toContain('boundaries/dependencies');
  });

  it('rejects node:fs in a domain layer', async () => {
    expect(ruleIds(await lint('fans/domain/uses-fs.ts'))).toContain('boundaries/dependencies');
  });

  it('rejects an import cycle', async () => {
    expect(ruleIds(await lint('media/domain/cycle-a.ts'))).toContain('import-x/no-cycle');
  });
});
