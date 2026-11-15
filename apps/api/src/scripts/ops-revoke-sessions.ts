/**
 * Signs out the dashboard: every session, or one user's (a stolen laptop, a departure).
 * Usage: `pnpm ops:revoke-sessions --all` or `pnpm ops:revoke-sessions --email <email>`.
 */
import { parseArgs } from 'node:util';

import { createDbClient } from '@impera/db';

import { loadConfig, ownerDatabaseUrl } from '../config';
import { revokeDashboardSessions } from '../ops';

import { requireArguments } from './command-line';

requireArguments('Usage: pnpm ops:revoke-sessions --all | --email <email>', {
  withValue: ['email'],
  alone: ['all'],
});
const { values } = parseArgs({
  options: { all: { type: 'boolean', default: false }, email: { type: 'string' } },
});
if (values.all === (values.email !== undefined)) {
  console.error('Usage: pnpm ops:revoke-sessions --all | --email <email>');
  process.exit(1);
}

const config = loadConfig();
const admin = createDbClient(ownerDatabaseUrl(config));
try {
  const revoked = await revokeDashboardSessions(admin.db, values.email ?? null);
  console.log(`${String(revoked)} session(s) révoquée(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
