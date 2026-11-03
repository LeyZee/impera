import { AiProviderSchema, ProviderConnectionStateSchema, ProviderErrorKindSchema } from '@impera/contracts';
import { customType, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, timestampTz, updatedAt } from './columns';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * One AI service key per provider, an agency setting (ADR 0016). Out of RLS and out of reach of `nirvana_app`
 * (the migration revokes it): only `withAdmin` reads or writes it. The key is AES-256-GCM sealed with
 * CREDENTIALS_ENCRYPTION_KEYS (crypto.ts, context = provider); the other columns are what its last check found.
 */
export const providerCredentials = pgTable(
  'provider_credentials',
  {
    provider: enumText('provider').primaryKey(),
    keyCiphertext: bytea('key_ciphertext').notNull(),
    /** Version of the encryption key that sealed it, to find the rows to re-encrypt after a rotation. */
    keyVersion: text('key_version').notNull(),
    /** The name given to the key in the provider console, when the provider says it. */
    keyLabel: text('key_label'),
    state: enumText('state').notNull(),
    summary: text('summary').notNull(),
    /** `ProviderFact[]`, `ProviderSettings`, `ProviderVoice[]` (packages/contracts), validated on read. */
    facts: jsonb('facts').notNull().default([]),
    settings: jsonb('settings').notNull().default({}),
    voices: jsonb('voices').notNull().default([]),
    charactersLeft: integer('characters_left'),
    lastErrorKind: enumText('last_error_kind'),
    verifiedAt: timestampTz('verified_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('provider_credentials', t.provider, AiProviderSchema.options),
    enumCheck(
      'provider_credentials',
      t.state,
      ProviderConnectionStateSchema.options.filter((state) => state !== 'not_connected'),
    ),
    enumCheck('provider_credentials', t.lastErrorKind, ProviderErrorKindSchema.options),
  ],
);
