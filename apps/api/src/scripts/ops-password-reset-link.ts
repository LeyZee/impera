/**
 * A new password for an account of the agency, an owner's included (27/11/2026: the private Telegram chats are gone).
 * The link is printed here, on the server, and sent nowhere: whoever runs this already holds the base. A member can be
 * given one from Équipe instead (EQ-10). The second factor stays as it is.
 * Usage: `pnpm ops:password-reset-link --email <email>`.
 */
import { parseArgs } from 'node:util';

import { createDbClient } from '@impera/db';

import { loadConfig, ownerDatabaseUrl } from '../config';
import { issuePasswordResetLink } from '../password-reset';

import { requireArguments } from './command-line';

const USAGE = 'Usage: pnpm ops:password-reset-link --email <email>';
requireArguments(USAGE, { withValue: ['email'] });
const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (values.email === undefined) {
  console.error(USAGE);
  process.exit(1);
}

const config = loadConfig();
const admin = createDbClient(ownerDatabaseUrl(config));
try {
  const result = await issuePasswordResetLink(admin.db, values.email, config.WEB_ORIGIN);
  if (result.kind === 'made') {
    console.log(
      `Lien valable ${String(result.minutes)} minutes, à ouvrir par la personne seule : ${result.url}`,
    );
  } else {
    console.error(
      result.kind === 'unknown'
        ? 'Aucun compte de l’agence (propriétaire, ou membre encore dans l’équipe) n’a cette adresse.'
        : 'Un lien a déjà été fait il y a moins de 5 minutes : attends, puis relance.',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
