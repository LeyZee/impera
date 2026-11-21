import { sql } from 'drizzle-orm';
import { boolean, check, customType, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './columns';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * The agency's key of the redirect service (ADR 0120 § 3), an agency setting: one row at most, which the base itself
 * holds to (`singleton` is the primary key and can only be true). Sealed with CREDENTIALS_ENCRYPTION_KEYS (crypto.ts,
 * context `link_service`), under FORCE RLS without any policy and revoked from `nirvana_app` by the migration: read
 * and written through `withAdmin` only, by the owner's gesture and the reading of the links. Kept only after the
 * service accepted it.
 */
export const linkServiceCredentials = pgTable(
  'link_service_credentials',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    keyCiphertext: bytea('key_ciphertext').notNull(),
    keyVersion: text('key_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('link_service_credentials_singleton_check', sql`${t.singleton}`)],
).enableRLS();
