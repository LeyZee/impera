import { sql } from '@impera/db';
import type { TestDb } from '@impera/db/testing';
import { z } from 'zod';

const RowSchema = z.object({ updated_at: z.coerce.date() });

export interface SessionTimes {
  /** Keeps the session of `cookie` alone, so that each step reads its own row. */
  keepOnly(email: string, cookie: string): Promise<void>;
  /** Its last refresh `idle` ago (a Postgres interval), Better Auth's own expiry well ahead. */
  idle(email: string, idle: string): Promise<unknown>;
  count(email: string): Promise<number>;
  /** When the session was last refreshed. */
  lastActive(email: string): Promise<Date>;
}

/**
 * A session's times moved in the base (ADR 0160): Better Auth reads its own clock, so a test makes a session idle by
 * moving its last refresh back. Each takes the account's `email`.
 */
export function sessionTimes(admin: TestDb['admin']['db']): SessionTimes {
  const ofAccount = (email: string) => sql`(select id from "user" where email = ${email})`;
  return {
    keepOnly: async (email: string, cookie: string) => {
      const token = /session_token=([^.;]+)\./.exec(cookie)?.[1];
      if (token === undefined) throw new Error(`no session cookie for ${email}`);
      await admin.execute(
        sql`delete from "session" where user_id = ${ofAccount(email)} and token <> ${token}`,
      );
    },
    idle: (email: string, idle: string) =>
      admin.execute(
        sql`update "session" set updated_at = now() - ${idle}::interval, expires_at = now() + interval '36 hours'
            where user_id = ${ofAccount(email)}`,
      ),
    count: async (email: string) =>
      (await admin.execute(sql`select 1 from "session" where user_id = ${ofAccount(email)}`)).rows.length,
    lastActive: async (email: string) =>
      RowSchema.parse(
        (await admin.execute(sql`select updated_at from "session" where user_id = ${ofAccount(email)}`))
          .rows[0],
      ).updated_at,
  };
}
