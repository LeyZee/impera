import { sql, type Database } from '@nirvana/db';
import { z } from 'zod';

const WaitsSchema = z.object({ waiting: z.number().int().min(0) });

/**
 * How many locks someone waits on in this test's database, advisory ones or of any kind. `pg_locks` shows every
 * database's waits, and the test files run side by side, each on its own database: a wait counts here only when the
 * session that waits is connected to this one, as `pg_stat_activity` says for every session, another role's too.
 */
export async function lockWaits(
  db: Pick<Database, 'execute'>,
  kind: 'advisory' | null = 'advisory',
): Promise<number> {
  const here = sql`select pid from pg_stat_activity where datname = current_database()`;
  const result = await db.execute(
    kind === null
      ? sql`select count(*)::int as waiting from pg_locks where not granted and pid in (${here})`
      : sql`select count(*)::int as waiting from pg_locks
            where locktype = ${kind} and not granted and pid in (${here})`,
  );
  return WaitsSchema.parse(result.rows[0]).waiting;
}
