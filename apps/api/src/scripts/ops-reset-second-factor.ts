/**
 * Puts one account's second factor back to zero (ADR 0046 § 2), for the owner who lost his phone and his backup codes:
 * his sessions and trusted devices end, and his next sign-in, with his password, activates a new code. A member is
 * sent a reset link from the dashboard instead (EQ-10).
 * Usage: `pnpm ops:reset-second-factor --email <email>`.
 */
import { parseArgs } from 'node:util';

import { createDbClient } from '@impera/db';

import { loadConfig, ownerDatabaseUrl } from '../config';
import { resetAccountSecondFactor } from '../ops';

import { requireArguments } from './command-line';

requireArguments('Usage: pnpm ops:reset-second-factor --email <email>', { withValue: ['email'] });
const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (values.email === undefined) {
  console.error('Usage: pnpm ops:reset-second-factor --email <email>');
  process.exit(1);
}

const config = loadConfig();
const admin = createDbClient(ownerDatabaseUrl(config));
try {
  const { hadSecondFactor } = await resetAccountSecondFactor(admin.db, values.email);
  console.log(
    hadSecondFactor
      ? 'Validation en deux étapes remise à zéro : à la prochaine connexion, le compte en active une nouvelle.'
      : 'Ce compte n’avait pas encore de validation en deux étapes ; ses sessions sont fermées.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
