/**
 * Re-seals the platform sessions with the newest key after a rotation (runbooks/rotate-secrets.md).
 * Usage: `pnpm ops:reencrypt-sessions`, with `SESSION_ENCRYPTION_KEYS=v2:<nouvelle>,v1:<ancienne>`.
 */
import { createDbClient, parseEncryptionKeys } from '@impera/db';

import { loadConfig, secretOrNull } from '../config';
import { reencryptPlatformSessions } from '../ops';

const config = loadConfig();
const keys = secretOrNull(config.SESSION_ENCRYPTION_KEYS);
if (keys === null) {
  console.error('SESSION_ENCRYPTION_KEYS manque dans l’environnement.');
  process.exit(1);
}
const admin = createDbClient(config.DATABASE_ADMIN_URL);
try {
  const rewritten = await reencryptPlatformSessions(
    admin.db,
    parseEncryptionKeys(keys, 'SESSION_ENCRYPTION_KEYS'),
  );
  console.log(`${String(rewritten)} session(s) rechiffrée(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
