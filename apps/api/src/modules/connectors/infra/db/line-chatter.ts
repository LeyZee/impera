import { sql } from '@impera/db';

/**
 * A line's chatter, the one rule the reads of the register share (pay, the totals, a day's refunds; ADR 0050 § 5): a
 * refund's is its sale's, should the platform ever name another chatter on it, and nobody when the sale had none; the
 * refund's own only when its sale is not in the register. For a query whose line is `l` and whose sale, left-joined
 * on the line's platform and id, is `s`.
 */
export const lineChatter = sql`case when l.event = 'refund' and s.platform_sale_id is not null
  then s.platform_chatter_id else l.platform_chatter_id end`;
