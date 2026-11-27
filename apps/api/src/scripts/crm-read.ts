/**
 * What a script run on the PC reads of the CRM's own database (OPS-11): the admin database named in `.env`, on a
 * connection that cannot write. Shared by `pnpm evals` and the calibration of her replies to comments.
 */
import { AiProviderSchema } from '@impera/contracts';
import { createDbClient, parseEncryptionKeys } from '@impera/db';
import { PROVIDERS } from '@impera/llm';
import { z } from 'zod';

import { READ_ONLY_POOL_OPTIONS } from '../key-check';
import { readSavedProviderKeys } from '../modules/providers/index';

/** The admin database on a read-only connection; `command` names the script and flag in the error. */
export function readOnlyAdminDb(command: string, needsSealing: boolean): ReturnType<typeof createDbClient> {
  const adminUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env['DATABASE_ADMIN_URL']);
  const sealing = process.env['CREDENTIALS_ENCRYPTION_KEYS'];
  if (!adminUrl.success || (needsSealing && (sealing === undefined || sealing === ''))) {
    console.error(
      `${command} : DATABASE_ADMIN_URL${needsSealing ? ' ou CREDENTIALS_ENCRYPTION_KEYS' : ''} manque dans .env.`,
    );
    process.exit(1);
  }
  return createDbClient(adminUrl.data, READ_ONLY_POOL_OPTIONS);
}

/**
 * The keys saved in the CRM, under the names the gateway reads (`LLM_XAI_API_KEY`…): read once on a read-only
 * connection, never shown. Only the services found are said, by name.
 */
export async function crmKeys(command: string): Promise<Record<string, string>> {
  const admin = readOnlyAdminDb(command, true);
  try {
    const saved = await readSavedProviderKeys(
      admin.db,
      parseEncryptionKeys(process.env['CREDENTIALS_ENCRYPTION_KEYS'] ?? '', 'CREDENTIALS_ENCRYPTION_KEYS'),
    );
    const found = PROVIDERS.flatMap((provider) => {
      const id = AiProviderSchema.safeParse(provider.id);
      const key = id.success ? saved[id.data] : undefined;
      return key === undefined ? [] : [{ provider, key }];
    });
    const names = found.map(({ provider }) => provider.label).join(', ');
    console.log(`Clés lues dans le CRM : ${names === '' ? 'aucune' : names}`);
    return Object.fromEntries(found.map(({ provider, key }) => [provider.apiKeyEnv, key]));
  } finally {
    await admin.close();
  }
}
