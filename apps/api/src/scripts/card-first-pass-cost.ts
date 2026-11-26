/**
 * What the first full read of the fan cards will cost (ADR 0085 § 7, amendement du 21/11), without any AI call: the
 * reads `fans.read_card` will chain to read what is unread in every conversation, times the average cost of the card
 * reads already journaled (`llm_calls` under the current `brain/fan-card` prompt). Read only, on a read-only pool.
 * Usage: `pnpm card:first-pass-cost`, against DATABASE_ADMIN_URL.
 */
import { FAN_CARD_READ_BATCH } from '@impera/contracts';
import { createDbClient, sql } from '@impera/db';
import { DEFAULT_LLM_CONFIG, loadPrompt } from '@impera/llm';
import { z } from 'zod';

import { READ_ONLY_POOL_OPTIONS } from '../key-check';
import { cardReadBatches, type CardReadRow } from '../modules/conversations';

import { requireArguments } from './command-line';

requireArguments('Usage: pnpm card:first-pass-cost');

const adminUrl = z.url({ protocol: /^postgres(ql)?$/ }).safeParse(process.env['DATABASE_ADMIN_URL']);
if (!adminUrl.success) {
  console.error('DATABASE_ADMIN_URL manque ou n’est pas une URL postgres.');
  process.exit(1);
}

const MessageRowSchema = z.object({
  conversationId: z.string(),
  readThrough: z.coerce.date().nullable(),
  id: z.string(),
  fromFan: z.boolean(),
  ingestedAt: z.coerce.date(),
});
const CostSchema = z.object({ calls: z.coerce.number(), averageMicroUsd: z.coerce.number().nullable() });

const admin = createDbClient(adminUrl.data, READ_ONLY_POOL_OPTIONS);
try {
  const messages = await admin.db.execute(sql`
    select m.conversation_id as "conversationId", c.card_read_through as "readThrough", m.id,
           m.author = 'fan' as "fromFan", m.created_at as "ingestedAt"
      from messages m join conversations c on c.id = m.conversation_id
     where m.text <> ''
     order by m.conversation_id, m.platform_created_at, m.id`);
  const byConversation = new Map<string, { readThrough: Date | null; rows: CardReadRow<string>[] }>();
  for (const row of z.array(MessageRowSchema).parse(messages.rows)) {
    const entry = byConversation.get(row.conversationId) ?? { readThrough: row.readThrough, rows: [] };
    entry.rows.push({ id: row.id, fromFan: row.fromFan, ingestedAt: row.ingestedAt });
    byConversation.set(row.conversationId, entry);
  }
  const batches = [...byConversation.values()].reduce(
    (sum, entry) => sum + cardReadBatches(entry.rows, entry.readThrough, FAN_CARD_READ_BATCH),
    0,
  );

  const cost = await admin.db.execute(sql`
    select count(*) as calls, avg(cost_micro_usd) as "averageMicroUsd"
      from llm_calls
     where prompt_hash = ${loadPrompt('brain', 'fan-card').hash} and status = 'ok' and cost_micro_usd is not null`);
  const { calls, averageMicroUsd } = CostSchema.parse(cost.rows[0]);

  console.log(`Conversations : ${String(byConversation.size)}`);
  console.log(`Lectures à faire (paquets de ${String(FAN_CARD_READ_BATCH.window)}) : ${String(batches)}`);
  if (averageMicroUsd === null || calls === 0) {
    console.log(
      'Aucune lecture de fiche mesurée encore : coût réel inconnu, relance après les premières lectures.',
    );
  } else {
    const usd = (batches * averageMicroUsd) / 1_000_000;
    const eur = usd / DEFAULT_LLM_CONFIG.dailyBudget.usdPerEur;
    console.log(
      `Coût moyen d’une lecture (${String(calls)} mesurées) : ${(averageMicroUsd / 1_000_000).toFixed(4)} $`,
    );
    console.log(`Coût de la première passe : ${usd.toFixed(2)} $, soit ${eur.toFixed(2)} €`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
