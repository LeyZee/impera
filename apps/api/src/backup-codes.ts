import { randomInt } from 'node:crypto';

import { BACKUP_CODE_ALPHABET, normalizeBackupCode } from '@impera/contracts';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';

const BACKUP_CODE_COUNT = 10;
const GROUP_LENGTH = 5;

const StoredCodesSchema = z.array(z.string());

function group(): string {
  return Array.from({ length: GROUP_LENGTH }, () =>
    BACKUP_CODE_ALPHABET.charAt(randomInt(BACKUP_CODE_ALPHABET.length)),
  ).join('');
}

/** Ten codes `XXXXX-XXXXX` in Crockford's base 32 (SEC-08): 50 bits each, copied by hand without doubt. */
function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => `${group()}-${group()}`);
}

/**
 * Better Auth's `backupCodeOptions` (ADR 0046): codes drawn by `generateBackupCodes`, stored encrypted with the auth
 * secret exactly as its `'encrypted'` mode does, and read back normalized (SEC-08). The typed code is normalized too
 * (`SecondFactorCodeSchema`), so a code is accepted whatever its case, the codes made before included.
 */
export function backupCodeOptions(secret: string): {
  amount: number;
  customBackupCodesGenerate: () => string[];
  storeBackupCodes: {
    encrypt: (data: string) => Promise<string>;
    decrypt: (data: string) => Promise<string>;
  };
} {
  return {
    amount: BACKUP_CODE_COUNT,
    customBackupCodesGenerate: generateBackupCodes,
    storeBackupCodes: {
      encrypt: (data) => symmetricEncrypt({ key: secret, data }),
      decrypt: async (data) => {
        const codes = StoredCodesSchema.parse(JSON.parse(await symmetricDecrypt({ key: secret, data })));
        return JSON.stringify(codes.map(normalizeBackupCode));
      },
    },
  };
}
