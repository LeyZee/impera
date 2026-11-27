/**
 * Lets the AI's platform account be synced again from scratch: forgets its stored session and the platform member it
 * pinned, when the first « Sync » was made with the wrong account (an owner's own, a chatter's) instead of the AI's
 * (audit de robustesse du 27/11). Messages, fans and sales stay; the account waits for its next « Sync ».
 * Usage: `pnpm ops:release-ai-account --list`, then `pnpm ops:release-ai-account --account <id>`.
 */
import { parseArgs } from 'node:util';

import { createDbClient } from '@impera/db';

import { loadConfig, ownerDatabaseUrl } from '../config';
import { listPlatformAccounts, releasePlatformSession } from '../ops';

import { requireArguments } from './command-line';

const USAGE = 'Usage: pnpm ops:release-ai-account --list | --account <id>';
requireArguments(USAGE, { withValue: ['account'], alone: ['list'] });
const { values } = parseArgs({
  options: { list: { type: 'boolean', default: false }, account: { type: 'string' } },
});
if (values.list === (values.account !== undefined)) {
  console.error(USAGE);
  process.exit(1);
}

const config = loadConfig();
const admin = createDbClient(ownerDatabaseUrl(config));
try {
  if (values.account === undefined) {
    for (const line of await listPlatformAccounts(admin.db)) {
      const session = line.hasSession ? `session ${line.sessionState}` : 'aucune session';
      console.log(`${line.id}  ${line.platform}  @${line.handle}  ${line.creator}  (${session})`);
    }
  } else if (await releasePlatformSession(admin.db, values.account)) {
    console.log('Session oubliée. Refais la première synchro avec le compte de l’IA.');
  } else {
    console.error('Compte introuvable : vérifie l’identifiant avec --list.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
