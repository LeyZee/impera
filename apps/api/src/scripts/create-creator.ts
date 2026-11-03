/**
 * Creates a creator (one creator, one persona): the dashboard lists her and her conversations hang off her.
 * Usage: `pnpm creator:create --name <nom> [--timezone Europe/Paris]`.
 */
import { parseArgs } from 'node:util';

import { NewCreatorSchema } from '@impera/contracts';

import { createApp } from '../composition-root';
import { loadConfig } from '../config';
import { createLogger } from '../logger';

const { values } = parseArgs({ options: { name: { type: 'string' }, timezone: { type: 'string' } } });
const input = NewCreatorSchema.safeParse({ displayName: values.name, timezone: values.timezone });
if (!input.success) {
  console.error('Usage: pnpm creator:create --name <nom> [--timezone Europe/Paris]');
  process.exit(1);
}

const config = loadConfig();
const app = await createApp(config, createLogger(config));
try {
  const creator = await app.modules.persona.creators.create(input.data);
  console.log(`Créatrice « ${creator.displayName} » créée (${creator.id}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
