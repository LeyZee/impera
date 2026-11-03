/**
 * Stores a persona version read from a YAML file and, with `--activate`, makes it the creator's only active one
 * (ADR 0010). The real persona lives outside the repository; this command reads it from wherever it is kept.
 * Usage: `pnpm persona:load <fichier.yaml> [--creator <id>] [--activate]`. Without `--creator`, the only creator.
 */
import { parseArgs } from 'node:util';

import { CreatorIdSchema } from '@impera/contracts';

import { createApp } from '../composition-root';
import { loadConfig } from '../config';
import { createLogger } from '../logger';

import { describeIssues, readPersonaYaml } from './persona-file';

const USAGE = 'Usage: pnpm persona:load <fichier.yaml> [--creator <id>] [--activate]';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { creator: { type: 'string' }, activate: { type: 'boolean', default: false } },
});
const [path] = positionals;
if (path === undefined) {
  console.error(USAGE);
  process.exit(1);
}

const result = await readPersonaYaml(path).catch((error: unknown) => {
  console.error(`Lecture impossible : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
if (!result.success) {
  console.error(`Persona invalide, rien n'est chargé (${String(result.error.issues.length)} problème(s)) :`);
  for (const line of describeIssues(result.error)) console.error(line);
  process.exit(1);
}

const config = loadConfig();
const app = await createApp(config, createLogger(config));
try {
  const creators = await app.modules.persona.creators.list('all');
  const creator =
    values.creator === undefined
      ? creators.length === 1
        ? creators[0]
        : undefined
      : creators.find((c) => c.id === CreatorIdSchema.parse(values.creator));
  if (creator === undefined) {
    console.error(
      values.creator === undefined
        ? `Précise la créatrice avec --creator : ${creators.map((c) => `${c.displayName} (${c.id})`).join(', ') || 'aucune créatrice, crée-la avec pnpm creator:create'}.`
        : 'Créatrice introuvable.',
    );
    process.exitCode = 1;
  } else {
    const loaded = await app.modules.persona.versions.load(creator.id, result.data, {
      sourcePath: path,
      activate: values.activate,
    });
    const { version, contentHash, isActive } = loaded.version;
    console.log(
      `${creator.displayName} : version ${version} ${loaded.created ? 'chargée' : 'déjà chargée'} (${contentHash.slice(0, 12)})` +
        (loaded.activated ? ', maintenant active.' : isActive ? ', déjà active.' : ', pas active.'),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
