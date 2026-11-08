import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The order of the migrations (bilan projet, R4). Drizzle's migrator applies a migration only when its `when` is later
 * than the last one applied: an entry merged with an earlier `when` is skipped in silence in production. And
 * `drizzle-kit generate` and `pnpm --filter @impera/db drift` read the snapshot of the greatest file name: a migration
 * numbered below the last one of main is compared against the wrong snapshot. Two PRs that each carry a migration,
 * merged in an order decided by hand, fall into one or the other; this file says it before the merge.
 */

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const META = `${DIR}meta/`;

const JournalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int(),
      when: z.number().int(),
      tag: z.string().regex(/^\d{4}_[\w-]+$/u),
    }),
  ),
});
const SnapshotSchema = z.object({ id: z.string(), prevId: z.string() });

/** Snapshots lost before this test existed; the chain resumes after them, it is not checked across them. */
const LOST_SNAPSHOTS: readonly string[] = ['0124'];
const ROOT_ID = '00000000-0000-0000-0000-000000000000';

const journal = JournalSchema.parse(JSON.parse(readFileSync(`${META}_journal.json`, 'utf8'))).entries;
const numberOf = (tag: string): string => tag.slice(0, 4);
const snapshotPath = (tag: string): string => `${META}${numberOf(tag)}_snapshot.json`;
const snapshotOf = (tag: string): z.infer<typeof SnapshotSchema> =>
  SnapshotSchema.parse(JSON.parse(readFileSync(snapshotPath(tag), 'utf8')));

describe('the migrations’ journal', () => {
  it('numbers its entries in order, once each', () => {
    expect(journal.map((entry) => entry.idx)).toEqual(journal.map((_, index) => index));
    const numbers = journal.map((entry) => Number(numberOf(entry.tag)));
    const later = numbers.slice(1).filter((number, index) => number <= (numbers[index] ?? -1));
    expect(
      later,
      'a migration numbered at or below the one before it: renumber it above the last of main',
    ).toEqual([]);
  });

  it('gives each migration a later `when` than the one before, or Drizzle skips it in production', () => {
    const skipped = journal.filter(
      (entry, index) => index > 0 && entry.when <= (journal[index - 1]?.when ?? 0),
    );
    expect(
      skipped.map((entry) => entry.tag),
      'merged second: regenerate it behind the last migration of main',
    ).toEqual([]);
  });

  it('holds every SQL file of the folder, and no entry without its file', () => {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/u, ''))
      .sort();
    expect(files).toEqual(journal.map((entry) => entry.tag).sort());
  });
});

describe('the migrations’ snapshots', () => {
  it('exist for each entry, chained in the journal’s order', () => {
    let previous: string | null = ROOT_ID;
    const broken: string[] = [];
    for (const entry of journal) {
      if (LOST_SNAPSHOTS.includes(numberOf(entry.tag))) {
        previous = null;
        continue;
      }
      expect(existsSync(snapshotPath(entry.tag)), `${entry.tag} has no snapshot`).toBe(true);
      const snapshot = snapshotOf(entry.tag);
      if (previous !== null && snapshot.prevId !== previous) broken.push(entry.tag);
      previous = snapshot.id;
    }
    expect(
      broken,
      'a snapshot whose prevId is not the one before it: regenerate it behind the last of main',
    ).toEqual([]);
  });

  it('end with the last entry’s, the one generate and drift read', () => {
    const [greatest] = readdirSync(META)
      .filter((name) => name.endsWith('_snapshot.json'))
      .sort()
      .reverse();
    const last = journal.at(-1);
    expect(last).toBeDefined();
    expect(greatest).toBe(`${numberOf(last?.tag ?? '')}_snapshot.json`);
  });
});
