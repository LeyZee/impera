/**
 * Recomputes a conversation's projection columns (`state`, `mode`, `last_*_at`, `unread_count`) from its journal
 * (ADR 0007), for a row that drifted or after a bug fix in the projection.
 * Usage: `pnpm db:rebuild-projections <conversationId>`.
 */
import { ConversationIdSchema, CreatorIdSchema } from '@impera/contracts';
import { eq, schema, withAdmin } from '@impera/db';

import { createApp } from '../composition-root';
import { loadConfig } from '../config';
import { createLogger } from '../logger';

import { requireArguments } from './command-line';

requireArguments('Usage: pnpm db:rebuild-projections <conversationId>', { positionals: true });
const parsed = ConversationIdSchema.safeParse(process.argv[2]);
if (!parsed.success) {
  console.error('Usage: pnpm db:rebuild-projections <conversationId>');
  process.exit(1);
}
const conversationId = parsed.data;

const config = loadConfig();
const app = await createApp(config, createLogger(config));
try {
  // The only cross-tenant read: which creator owns this conversation. The rebuild itself runs in her tenant.
  const [row] = await withAdmin(app.adminDb.db, (tx) =>
    tx
      .select({ creatorId: schema.conversations.creatorId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId)),
  );
  if (row === undefined) throw new Error('Conversation introuvable');
  const projection = await app.modules.conversations.rebuildProjection(
    CreatorIdSchema.parse(row.creatorId),
    conversationId,
  );
  console.log(JSON.stringify(projection, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
