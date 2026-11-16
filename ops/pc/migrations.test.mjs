// Tests of ops/pc/migrations.mjs (ADR 0125 § 2 and § 4). Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { destructiveKinds, journalTags, migrationDiff, refusedMigrations } from './migrations.mjs';

test('reads the tags of a Drizzle journal, and refuses anything else', () => {
  const text = JSON.stringify({
    entries: [
      { idx: 0, tag: '0000_core' },
      { idx: 1, tag: '0001_more' },
    ],
  });
  assert.deepEqual(journalTags(text), ['0000_core', '0001_more']);
  assert.throws(() => journalTags('{}'));
  assert.throws(() => journalTags(JSON.stringify({ entries: [{ idx: 0 }] })));
  assert.throws(() => journalTags(JSON.stringify({ entries: [{ tag: '../0001_more' }] })));
  assert.throws(() => journalTags(JSON.stringify({ entries: [{ tag: '0001_More' }] })));
});

test('the migrations a commit adds, even several days late at once', () => {
  assert.deepEqual(migrationDiff(['a'], ['a', 'b', 'c']), { rewritten: false, added: ['b', 'c'] });
  assert.deepEqual(migrationDiff(['a', 'b'], ['a', 'b']), { rewritten: false, added: [] });
});

test('code behind the base adds nothing; a rewritten history is refused', () => {
  assert.deepEqual(migrationDiff(['a', 'b'], ['a']), { rewritten: false, added: [] });
  assert.deepEqual(migrationDiff(['a', 'b'], ['a', 'x', 'c']), { rewritten: true, added: [] });
});

test('finds the statements that can lose data', () => {
  assert.deepEqual(destructiveKinds('DROP TABLE "fans";'), ['DROP TABLE']);
  assert.deepEqual(destructiveKinds('ALTER TABLE "fans" DROP COLUMN "note";'), ['DROP COLUMN']);
  assert.deepEqual(destructiveKinds('ALTER TABLE fans DROP note;'), ['ALTER TABLE DROP']);
  assert.deepEqual(destructiveKinds('--> statement-breakpoint\ntruncate table jobs;'), ['TRUNCATE']);
  assert.deepEqual(destructiveKinds('delete from drafts where true;'), ['DELETE FROM']);
  assert.deepEqual(destructiveKinds('DROP SCHEMA old CASCADE;'), ['DROP SCHEMA']);
});

test('lets through what removes no rows', () => {
  for (const sql of [
    'ALTER TABLE "fans" DROP CONSTRAINT "fans_pk";',
    'ALTER TABLE fans ALTER COLUMN note DROP NOT NULL;',
    'ALTER TABLE fans ALTER COLUMN note DROP DEFAULT;',
    'CREATE TABLE x (id uuid REFERENCES fans(id) ON DELETE CASCADE);',
    'REVOKE UPDATE, DELETE, TRUNCATE ON drafts FROM impera_service;',
    'DROP POLICY IF EXISTS p ON fans;',
    'DROP INDEX IF EXISTS i;',
  ]) {
    assert.deepEqual(destructiveKinds(sql), [], sql);
  }
});

test('a destructive migration is refused unless the owner named it', () => {
  const sql = new Map([
    ['0001_drop', 'DROP TABLE old;'],
    ['0002_add', 'CREATE TABLE new (id int);'],
  ]);
  assert.deepEqual(refusedMigrations(sql, []), [{ tag: '0001_drop', kinds: ['DROP TABLE'] }]);
  assert.deepEqual(refusedMigrations(sql, ['0001_drop']), []);
});
