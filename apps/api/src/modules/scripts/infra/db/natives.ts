import { CurrencySchema } from '@impera/contracts';
import { schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { NativeScriptForMatch } from '../../domain/recognition';

const NativeRowSchema = z.object({
  script_id: z.string(),
  name: z.string(),
  step_ref: z.string(),
  platform_index: z.number().int(),
  price_minor: z.number().int(),
  currency: CurrencySchema,
  sold: z.array(z.string()),
});

/**
 * The account's active native scripts as the recognition reads them (ADR 0112 § 23), each branch with the media it
 * sells, in the transaction given (the person's under her RLS, or the service role's). `name`: only those of that name,
 * trimmed. `free`: only those that no script in preparation took and on which the agency set no branch.
 */
export async function nativesOf(
  tx: Transaction,
  platformAccountId: string,
  filter: { readonly name?: string; readonly free?: boolean },
): Promise<NativeScriptForMatch[]> {
  const byName = filter.name === undefined ? sql`` : sql`and btrim(s.name) = ${filter.name.trim()}`;
  const free =
    filter.free === true
      ? sql`and not exists (select 1 from ${schema.preparedScripts} p where p.matched_platform_script_id = s.id)
            and not exists (select 1 from ${schema.platformScriptBranches} b where b.platform_script_id = s.id)`
      : sql``;
  const result = await tx.execute(sql`
    select s.id as script_id, s.name, st.platform_step_ref as step_ref, st.platform_index,
      st.price_minor, st.currency,
      coalesce(array_agg(m.platform_media_ref order by m.rank)
        filter (where m.platform_media_ref is not null), '{}') as sold
    from ${schema.platformScripts} s
    join ${schema.platformScriptSteps} st on st.platform_script_id = s.id
    left join ${schema.platformScriptStepMedia} m
      on m.platform_script_id = st.platform_script_id and m.position = st.position and m.role = 'sold'
    where s.platform_account_id = ${platformAccountId}::uuid and s.active ${byName} ${free}
    group by s.id, s.name, st.platform_step_ref, st.platform_index, st.price_minor, st.currency, st.position
    order by s.created_at, s.id, st.position`);
  const natives = new Map<string, { name: string; branches: NativeScriptForMatch['branches'][number][] }>();
  for (const row of z.array(NativeRowSchema).parse(result.rows)) {
    const native = natives.get(row.script_id) ?? { name: row.name, branches: [] };
    native.branches.push({
      ref: row.step_ref,
      platformIndex: row.platform_index,
      priceMinor: row.price_minor,
      currency: row.currency,
      soldMediaRefs: row.sold,
    });
    natives.set(row.script_id, native);
  }
  return [...natives.entries()].map(([id, native]) => ({ id, ...native }));
}
