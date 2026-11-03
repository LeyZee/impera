/**
 * Turns a kill switch on or off (message-flow.md §6, runbooks/incident.md).
 * Usage: `pnpm ops:kill-switch --on|--off --scope global|creator|conversation [--id <uuid>] --reason "<texte>"`.
 */
import { parseArgs } from 'node:util';

import { createDbClient } from '@impera/db';

import { loadConfig } from '../config';
import { KillSwitchInputSchema, setKillSwitch } from '../ops';

const { values } = parseArgs({
  options: {
    on: { type: 'boolean', default: false },
    off: { type: 'boolean', default: false },
    scope: { type: 'string' },
    id: { type: 'string' },
    reason: { type: 'string' },
  },
});
const input = KillSwitchInputSchema.safeParse({
  active: values.on,
  scope: values.scope,
  scopeId: values.id ?? null,
  reason: values.reason,
});
if (values.on === values.off || !input.success) {
  console.error(
    'Usage: pnpm ops:kill-switch --on|--off --scope global|creator|conversation [--id <uuid>] --reason "<texte>"',
  );
  process.exit(1);
}

const config = loadConfig();
const admin = createDbClient(config.DATABASE_ADMIN_URL);
try {
  await setKillSwitch(admin.db, input.data);
  console.log(`Interrupteur ${input.data.scope} ${input.data.active ? 'activé' : 'levé'}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
