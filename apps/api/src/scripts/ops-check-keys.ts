/**
 * Proves that the copy of SESSION_ENCRYPTION_KEYS and CREDENTIALS_ENCRYPTION_KEYS kept with the backups' private key
 * still opens the data (ADR 0028 § 7, OPS-02): read only, nothing called, nothing decrypted shown. The keys are typed
 * without echo, never taken from the environment: the point is to test the kept copy, not the server's.
 * Usage: `pnpm ops:check-keys` (image: `node dist/scripts/ops-check-keys.js`), against DATABASE_ADMIN_URL.
 */
import { createDbClient, parseEncryptionKeys } from '@nirvana/db';
import { z } from 'zod';

import { checkEncryptionKeys, READ_ONLY_POOL_OPTIONS } from '../key-check';

import { readSecret } from './read-secret';

// Only the admin URL is read, not the whole configuration: a restored copy on a PC has no other variable.
const adminUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env['DATABASE_ADMIN_URL']);
if (!adminUrl.success) {
  console.error('DATABASE_ADMIN_URL manque ou n’est pas une URL postgres.');
  process.exit(1);
}

const admin = createDbClient(adminUrl.data, READ_ONLY_POOL_OPTIONS);
try {
  const session = parseEncryptionKeys(
    await readSecret('SESSION_ENCRYPTION_KEYS (copie gardée) : '),
    'SESSION_ENCRYPTION_KEYS',
  );
  const credentials = parseEncryptionKeys(
    await readSecret('CREDENTIALS_ENCRYPTION_KEYS (copie gardée) : '),
    'CREDENTIALS_ENCRYPTION_KEYS',
  );
  const families = await checkEncryptionKeys(admin.db, { session, credentials });
  for (const family of families) {
    const opened = family.total - family.unreadable.length;
    const line = `${family.label} (${family.keys}) : ${String(opened)} sur ${String(family.total)} ouverte(s)`;
    if (family.unreadable.length === 0) console.log(line);
    else console.error(`${line}. Illisible(s) : ${family.unreadable.join(', ')}`);
  }
  if (families.every((family) => family.total === 0)) {
    console.error(
      'Aucune donnée chiffrée dans cette base : rien ne prouve encore que ces clés sont les bonnes.',
    );
    process.exitCode = 1;
  } else if (families.some((family) => family.unreadable.length > 0)) {
    console.error(
      'La copie des clés ne correspond pas à la base : remets-la à jour depuis le serveur (rotate-secrets.md).',
    );
    process.exitCode = 1;
  } else {
    console.log('La copie des clés ouvre toutes les données chiffrées.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
