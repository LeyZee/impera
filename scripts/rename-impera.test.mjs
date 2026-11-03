// Tests of scripts/rename-impera.mjs. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { finishedCard, inScope, leftovers, renamePath, renameText } from './rename-impera.mjs';

test('renames the name in every case', () => {
  assert.equal(
    renameText("import { x } from '@nirvana/contracts';"),
    "import { x } from '@impera/contracts';",
  );
  assert.equal(renameText('<title>Nirvana</title>'), '<title>Impera</title>');
  assert.equal(renameText('NIRVANA_INLINE_WORKER=1'), 'IMPERA_INLINE_WORKER=1');
  assert.equal(renameText("headers['x-nirvana-client-ip']"), "headers['x-impera-client-ip']");
  assert.equal(renameText('class NirvanaPlatformConnector'), 'class ImperaPlatformConnector');
});

test('elides « de » and « que » before Impera, with the typographic apostrophe', () => {
  assert.equal(renameText('Chargement de Nirvana'), 'Chargement d’Impera');
  assert.equal(renameText('De Nirvana à Reveal'), 'D’Impera à Reveal');
  assert.equal(renameText('C’est ici que Nirvana te préviendra.'), 'C’est ici qu’Impera te préviendra.');
  assert.equal(renameText('lorsque Nirvana répond'), 'lorsqu’Impera répond');
  // A word that only ends in « de » is not elided.
  assert.equal(renameText('mode Nirvana'), 'mode Impera');
  assert.equal(renameText('étude Nirvana'), 'étude Impera');
});

test('keeps what ADR 0062 § 2 keeps', () => {
  assert.equal(
    renameText('postgres://nirvana_app:change-me@localhost:5432/nirvana'),
    'postgres://nirvana_app:change-me@localhost:5432/impera',
  );
  assert.equal(renameText('grant select to nirvana_admin;'), 'grant select to nirvana_admin;');
  assert.equal(
    renameText("export const ENGINE_VERSION = 'nirvana-2';"),
    "export const ENGINE_VERSION = 'nirvana-2';",
  );
  assert.equal(renameText('z.string().regex(/^nirvana-\\d+$/)'), 'z.string().regex(/^nirvana-\\d+$/)');
  assert.equal(renameText('la version `nirvana-N` reste'), 'la version `nirvana-N` reste');
  assert.equal(
    renameText("sql`${t.engineVersion} ~ '^nirvana-[0-9]+$'`"),
    "sql`${t.engineVersion} ~ '^nirvana-[0-9]+$'`",
  );
  assert.equal(renameText('`${hash}@nirvana`;'), '`${hash}@nirvana`;');
  assert.equal(renameText('https://github.com/LeyZee/nirvana'), 'https://github.com/LeyZee/nirvana');
  assert.equal(
    renameText('C:\\Users\\USER\\Downloads\\Projet Nirvana'),
    'C:\\Users\\USER\\Downloads\\Projet Nirvana',
  );
  // The caches and the engine are told apart by what follows the dash.
  assert.equal(renameText('`nirvana-shell-${VERSION}`'), '`impera-shell-${VERSION}`');
});

test('leaves a line that names the old word on purpose', () => {
  const legacy = "const LEGACY_APPEARANCE = 'nirvana.appearance'; // read once, then removed (ADR 0062)";
  assert.equal(renameText(legacy), legacy);
});

test('is idempotent', () => {
  const text = 'Chargement de Nirvana\n@nirvana/db\nnirvana_app nirvana-1\nNIRVANA_X\n';
  assert.equal(renameText(renameText(text)), renameText(text));
});

test('reports a missed elision', () => {
  assert.deepEqual(leftovers('ok\nle guide de Impera\n'), ['le guide de Impera']);
  assert.deepEqual(leftovers('le guide d’Impera'), []);
});

test('leaves history and migrations out', () => {
  const none = () => '';
  assert.equal(inScope('packages/db/migrations/0028_pay.sql', none), false);
  assert.equal(inScope('packages/db/migrations/meta/_journal.json', none), false);
  assert.equal(inScope('docs/adr/0023-team.md', none), false);
  assert.equal(inScope('docs/sessions/log/2026-11-03-x.md', none), false);
  assert.equal(inScope('brainstorm/01-premier-echange.md', none), false);
  assert.equal(inScope('apps/web/public/icons/icon-512.png', none), false);
  assert.equal(inScope('apps/web/src/App.tsx', none), true);
  assert.equal(
    inScope('docs/sessions/tasks/X-01.md', () => '# X-01\nStatut : done\n'),
    false,
  );
  assert.equal(
    inScope('docs/sessions/tasks/X-02.md', () => '# X-02\nStatut : in_progress\n'),
    true,
  );
});

test('reads the status of a task card', () => {
  assert.equal(finishedCard('# T\nStatut : done (ID validé par Charles)\n'), true);
  assert.equal(finishedCard('# T\nStatut : todo\n…\nStatut : done\n'), false);
  assert.equal(finishedCard('# T\n**Statut** : done\n'), true);
  assert.equal(finishedCard('# T\n'), false);
});

test('renames file names', () => {
  assert.equal(renamePath('brand/nirvana-mark.svg'), 'brand/impera-mark.svg');
  assert.equal(renamePath('apps/web/src/App.tsx'), 'apps/web/src/App.tsx');
});
