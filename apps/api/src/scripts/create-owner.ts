/**
 * Creates a dashboard `owner` account; there is no public sign-up (P0-07a).
 * Usage: `pnpm owner:create --email <email> --name <name>`, then type the password (12 characters minimum).
 * The password is read from the terminal without echo, twice, never from an argument: it stays off the screen and out
 * of the shell history.
 */
import { parseArgs } from 'node:util';

import { createOwner } from '../auth';
import { createApp } from '../composition-root';
import { loadConfig } from '../config';
import { createLogger } from '../logger';

import { requireArguments } from './command-line';
import { readSecret } from './read-secret';

requireArguments('Usage: pnpm owner:create --email <email> --name <name>', { withValue: ['email', 'name'] });
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (values.email === undefined || values.name === undefined) {
  console.error('Usage: pnpm owner:create --email <email> --name <name>');
  process.exit(1);
}

const password = await readSecret('Mot de passe (12 caractères minimum) : ');
if ((await readSecret('Confirme le mot de passe : ')) !== password) {
  console.error('Les deux mots de passe ne sont pas identiques. Rien n’a été créé.');
  process.exit(1);
}

const config = loadConfig();
const app = await createApp(config, createLogger(config));
try {
  const { userId } = await createOwner(
    app.auth,
    app.db.db,
    { email: values.email, name: values.name, password },
    app.passwordBreaches,
  );
  console.log(
    `Compte owner créé (${userId}). À la première connexion, il active sa validation en deux étapes.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
