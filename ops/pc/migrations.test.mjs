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
  assert.deepEqual(destructiveKinds('ALTER TABLE fans DROP note;'), ['DROP']);
  assert.deepEqual(destructiveKinds('--> statement-breakpoint\ntruncate table jobs;'), ['TRUNCATE']);
  assert.deepEqual(destructiveKinds('delete from drafts where true;'), ['DELETE']);
  assert.deepEqual(destructiveKinds('DROP SCHEMA old CASCADE;'), ['DROP SCHEMA']);
});

// The spellings the Sécurité review (16/11) let through the first rule, a list of forbidden words.
test('refuses what a list of forbidden words let through', () => {
  for (const [sql, kinds] of [
    ['DROP TYPE "status" CASCADE;', ['DROP TYPE']],
    ['DROP OWNED BY impera_service;', ['DROP OWNED']],
    ['DROP SEQUENCE s CASCADE;', ['DROP SEQUENCE']],
    ['DROP EXTENSION pgcrypto CASCADE;', ['DROP EXTENSION']],
    ['DROP MATERIALIZED VIEW totals;', ['DROP MATERIALIZED']],
    ['DROP/**/TABLE fans;', ['DROP']],
    ['DROP -- x\nTABLE fans;', ['DROP']],
    ['DROP INDEX/**/x;', []],
    ['DELETE/**/FROM fans;', ['DELETE']],
    ['ALTER TABLE "members" DROP "2fa";', ['DROP']],
    ['DO $$ BEGIN TRUNCATE jobs; END $$;', ['TRUNCATE']],
    ['BEGIN; TRUNCATE jobs;', ['TRUNCATE']],
    ['BEGIN; TRUNCATE jobs; COMMIT;', ['TRUNCATE']],
    ['ALTER TABLE fans DISABLE ROW LEVEL SECURITY;', ['RLS OFF']],
    ['ALTER TABLE fans NO FORCE ROW LEVEL SECURITY;', ['RLS OFF']],
    ["SELECT '--'; drop table fans;", ['DROP TABLE']],
    ['/* -- */ drop table fans;', ['DROP TABLE']],
    ["COMMENT ON TABLE a IS 'x -- y'; truncate fans;", ['TRUNCATE']],
    ["DO $$ BEGIN EXECUTE 'x -- ' || 'y'; delete from fans; END $$;", ['DELETE']],
    ["DO $$ BEGIN EXECUTE 'DELETE FROM fans'; END $$;", ['DELETE']],
    ['GRANT SELECT ON a TO r\n--> statement-breakpoint\nTRUNCATE fans;', ['TRUNCATE']],
    ['GRANT SELECT ON a TO r\n--> statement-breakpoint\nDELETE FROM fans;', ['DELETE']],
    ["-- it's DROP TABLE time\nCREATE TABLE x (id int);", ['DROP TABLE']],
    ['CREATE TABLE x (id int); -- DROP TABLE later', ['DROP TABLE']],
    ['drop table fans; -- tidy', ['DROP TABLE']],
    ['CREATE TABLE x (id int); delete from x; -- one', ['DELETE']],
  ]) {
    assert.deepEqual(destructiveKinds(sql), kinds, sql);
  }
});

test('lets through what removes no rows', () => {
  for (const sql of [
    'ALTER TABLE "fans" DROP CONSTRAINT "fans_pk";',
    'ALTER TABLE fans ALTER COLUMN note DROP NOT NULL;',
    'ALTER TABLE fans ALTER COLUMN note DROP DEFAULT;',
    'ALTER TABLE fans ALTER COLUMN id DROP IDENTITY IF EXISTS;',
    'CREATE TABLE x (id uuid REFERENCES fans(id) ON DELETE CASCADE);',
    'REVOKE UPDATE, DELETE, TRUNCATE ON drafts FROM impera_service;',
    'CREATE TABLE x (id int);--> statement-breakpoint\nGRANT SELECT, INSERT, UPDATE, DELETE ON x TO nirvana_app;',
    'CREATE TRIGGER "x_append_only" BEFORE UPDATE OR DELETE ON "x" FOR EACH ROW EXECUTE FUNCTION refuse();',
    'CREATE TRIGGER "x_kept" BEFORE DELETE ON "x" FOR EACH ROW EXECUTE FUNCTION refuse();',
    'DROP POLICY IF EXISTS p ON fans;',
    'DROP INDEX IF EXISTS i;',
    'DROP TRIGGER IF EXISTS t ON fans;',
    'CREATE POLICY "no_delete" ON x AS RESTRICTIVE FOR DELETE TO public USING (false);',
    '-- a content drop is never deleted: delete and truncate stay revoked\nCREATE TABLE x (id int);',
    '-- no UPDATE, no DELETE, a TRUNCATE would pass the RLS: we DROP TABLE nothing\nCREATE TABLE x (id int);',
    '-- refuses every UPDATE\n-- and DELETE, whoever asks; the rights say the same\nREVOKE UPDATE, DELETE, TRUNCATE ON\n\t"a"\n\tFROM r;',
    "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END $$;",
    'ALTER TABLE fans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\nALTER TABLE fans FORCE ROW LEVEL SECURITY;',
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
