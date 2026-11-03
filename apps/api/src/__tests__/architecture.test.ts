import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JOB_NAMES } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { JOBS_WITHOUT_TASK } from '../wiring/shared';

/**
 * The architecture tests of ADR 0047 § 1, read from the sources as they are (no build, no database): each table of pay
 * has one owner, written in its README; between pay's four modules a table is read only by its owner; each job has
 * exactly one task, registered by one wiring file, and a pay job is enqueued only by the module that registers it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..');
const modulesDir = path.join(src, 'modules');
const schemaDir = path.resolve(src, '../../../packages/db/src/schema');

/** Pay's four modules (ADR 0047 § 1). */
const PAY = ['payroll', 'invoicing', 'contractors', 'accounting'] as const;
const payModules: readonly string[] = PAY;

/** The schema files of pay's tables. */
const PAY_SCHEMAS = ['payroll.ts', 'invoices.ts'];

/**
 * The reads of another pay module's table that ARC-07 has not closed yet, as `<module>/<file>: <table>`. The list only
 * shrinks: a new read fails the test, and a read closed by a port fails it too until its line is removed here.
 */
const OPEN_CROSSINGS = [
  'invoicing/infra/invoice-acceptance-store.ts: commission_statements',
  'invoicing/infra/invoice-acceptance-store.ts: pay_adjustments',
  'invoicing/infra/invoice-pdf-store.ts: agency_logos',
  'invoicing/infra/invoice-pdf-store.ts: billing_settings',
  'invoicing/infra/invoice-pdf-store.ts: commission_statement_lines',
  'invoicing/infra/invoice-pdf-store.ts: commission_statements',
  'invoicing/infra/invoice-pdf-store.ts: contract_acceptances',
  'invoicing/infra/invoice-pdf-store.ts: contract_texts',
  'invoicing/infra/invoice-pdf-store.ts: contractor_document_reviews',
  'invoicing/infra/invoice-pdf-store.ts: contractor_documents',
  'invoicing/infra/invoice-store.ts: billing_regime_validations',
  'invoicing/infra/invoice-store.ts: billing_regimes',
  'invoicing/infra/invoice-store.ts: billing_settings',
  'invoicing/infra/invoice-store.ts: commission_statement_lines',
  'invoicing/infra/invoice-store.ts: commission_statements',
  'invoicing/infra/invoice-store.ts: contract_acceptances',
  'invoicing/infra/invoice-store.ts: contract_texts',
  'invoicing/infra/invoice-store.ts: contractor_document_reviews',
  'invoicing/infra/invoice-store.ts: contractor_documents',
  'invoicing/infra/invoice-store.ts: contractor_profiles',
  'invoicing/infra/invoice-store.ts: contractor_regimes',
  'invoicing/infra/invoice-store.ts: pay_adjustments',
  'invoicing/infra/payout-facts.ts: billing_regimes',
  'invoicing/infra/payout-facts.ts: contractor_document_reviews',
  'invoicing/infra/payout-facts.ts: contractor_documents',
  'invoicing/infra/payout-facts.ts: contractor_regimes',
  'invoicing/infra/requeue-store.ts: commission_statements',
  'invoicing/infra/settlement-rows.ts: carry_overs',
  'invoicing/infra/settlement-rows.ts: commission_statements',
];

const read = (file: string): string => readFileSync(file, 'utf8');

/** A module's code: every `.ts` under it but its tests and their support. */
function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => !file.split(path.sep).includes('__tests__'))
    .map((file) => path.join(dir, file))
    .sort();
}

/** The code without its comments, which name tables and jobs freely. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|\s)\/\/.*$/gmu, '$1');

/** The Drizzle tables a schema file defines: SQL name → the name `schema` exports. */
function tablesOf(file: string): Map<string, string> {
  const tables = new Map<string, string>();
  for (const match of read(file).matchAll(/export const (\w+) = pgTable\(\s*'(\w+)'/gu)) {
    const [, exported, name] = match;
    if (exported !== undefined && name !== undefined) tables.set(name, exported);
  }
  return tables;
}

const allTables = new Map(
  readdirSync(schemaDir)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => [...tablesOf(path.join(schemaDir, file))]),
);
const payTables = PAY_SCHEMAS.flatMap((file) => [...tablesOf(path.join(schemaDir, file)).keys()]);

/** Pay's tables a module's README names in its « Tables possédées » paragraph. */
function ownedBy(module: string): string[] {
  let readme: string;
  try {
    readme = read(path.join(modulesDir, module, 'README.md'));
  } catch {
    return [];
  }
  const paragraph = readme.split('\n').find((line) => line.startsWith('**Tables possédées'));
  if (paragraph === undefined) return [];
  return [...paragraph.matchAll(/`([a-z_0-9]+)`/gu)]
    .map(([, name]) => name ?? '')
    .filter((name) => payTables.includes(name));
}

const modules = readdirSync(modulesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** Each of pay's tables, and the modules whose README says they own it. */
const ownersOf = new Map<string, string[]>(payTables.map((table) => [table, []]));
for (const module of modules) {
  for (const table of ownedBy(module)) ownersOf.get(table)?.push(module);
}

/** The tables a file reads or writes: through `schema` (Drizzle), or named in SQL after a keyword that takes one. */
function tablesIn(code: string): Set<string> {
  const exported = new Set([...code.matchAll(/\bschema\.(\w+)/gu)].map(([, name]) => name));
  for (const [, names] of code.matchAll(/const\s*\{([^}]*)\}\s*=\s*schema\b/gu)) {
    for (const name of (names ?? '').split(',')) exported.add(name.split(':')[0]?.trim());
  }
  const found = new Set<string>();
  for (const [table, name] of allTables) {
    const inSql = new RegExp(`\\b(from|join|into|update|table)\\s+(public\\.)?"?${table}\\b`, 'iu');
    if (exported.has(name) || inSql.test(code)) found.add(table);
  }
  return found;
}

describe('architecture of pay (ADR 0047 § 1)', () => {
  it("gives each of pay's tables exactly one owner, the module whose README names it", () => {
    const notOne = [...ownersOf].filter(([, owners]) => owners.length !== 1);
    expect(notOne).toEqual([]);
  });

  it("finds each table its owner uses in the owner's code: the reading of the sources is not blind", () => {
    for (const module of PAY) {
      const used = new Set(
        sourcesOf(path.join(modulesDir, module)).flatMap((file) => [
          ...tablesIn(withoutComments(read(file))),
        ]),
      );
      expect(ownedBy(module).filter((table) => !used.has(table))).toEqual([]);
    }
  });

  it("reads another pay module's table only where a read is still open (ARC-07)", () => {
    const crossings: string[] = [];
    for (const module of PAY) {
      for (const file of sourcesOf(path.join(modulesDir, module))) {
        for (const table of tablesIn(withoutComments(read(file)))) {
          const owner = ownersOf.get(table)?.[0];
          if (owner !== undefined && owner !== module && payModules.includes(owner)) {
            crossings.push(`${path.relative(modulesDir, file).split(path.sep).join('/')}: ${table}`);
          }
        }
      }
    }
    expect(crossings.sort()).toEqual([...OPEN_CROSSINGS].sort());
  });

  /** Each task as a wiring file registers it: `'<job>': defineTask(`, with the file it is in. */
  const registrations = [
    ...readdirSync(path.join(src, 'wiring')).map((file) => path.join(src, 'wiring', file)),
    path.join(src, 'composition-root.ts'),
  ].flatMap((file) =>
    [...withoutComments(read(file)).matchAll(/^\s+'([a-z_]+\.[a-z_]+)': defineTask\(/gmu)].map(([, job]) => ({
      job: job ?? '',
      wiring: path.basename(file, '.ts'),
    })),
  );

  it('registers the task of each job exactly once, in one wiring file', () => {
    const withoutTask: readonly string[] = JOBS_WITHOUT_TASK;
    const expected = JOB_NAMES.filter((job) => !withoutTask.includes(job)).sort();
    const registered = registrations.map(({ job }) => job);
    expect(registered.filter((job, index) => registered.indexOf(job) !== index)).toEqual([]);
    expect([...registered].sort()).toEqual(expected);
  });

  it('enqueues a pay job only from the module that registers its task', () => {
    const wiringOf = new Map(registrations.map(({ job, wiring }) => [job, wiring]));
    const elsewhere: string[] = [];
    const unread: string[] = [];
    let enqueued = 0;
    for (const module of PAY) {
      for (const file of sourcesOf(path.join(modulesDir, module))) {
        const code = withoutComments(read(file));
        const jobs = [...code.matchAll(/task\s*=>\s*'([a-z_]+\.[a-z_]+)'/gu)].map(([, job]) => job ?? '');
        // Every enqueue names its job in plain text, or the test could not read it: not blind.
        const enqueues = code.match(/enqueue_job\(|jobs\.enqueue\(/gu)?.length ?? 0;
        if (enqueues !== jobs.length) unread.push(path.relative(modulesDir, file));
        enqueued += jobs.length;
        for (const job of jobs) {
          if (wiringOf.get(job) !== module)
            elsewhere.push(`${module}: ${job} (${wiringOf.get(job) ?? 'no task'})`);
        }
      }
    }
    expect(unread).toEqual([]);
    expect(enqueued).toBeGreaterThan(0);
    expect(elsewhere).toEqual([]);
  });
});
