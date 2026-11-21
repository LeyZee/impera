import {
  PayoutDestinationListSchema,
  PayoutDestinationSchema,
  type PayoutDetails,
  type PutPayoutDetailsBody,
  type TeamMember,
} from '@impera/contracts';
import { eq, parseEncryptionKeys, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { checkPayoutDestinations, resealPayoutDestinations } from '../modules/contractors';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/**
 * « Où te verser » (ADR 0165, trou n° 5 de la grande recette du 21/11). Invented people and numbers only (ADR 0010):
 * no real name, phone nor account.
 */
const KEYS = `v1:${Buffer.alloc(32, 7).toString('base64')}`;

const THEO_MOMO: PayoutDetails = {
  method: 'mobile_money',
  beneficiary: 'Théo Inventé',
  phone: '+229 00 00 00 01',
  operator: 'Opérateur fictif',
  note: null,
};
const THEO_BANK: PayoutDetails = {
  method: 'bank_account',
  beneficiary: 'Théo Inventé',
  account: 'ZZ00 1234 5678 9012',
  bank: 'Banque imaginaire',
  note: 'Compte courant',
};
/** Strings that must never leave the sealed block: not in the audit log, not in a list. */
const SECRETS = ['Inventé', '22900000001', '00000001', 'ZZ001234', 'Banque imaginaire', 'Compte courant'];

const LOU_CASH: PayoutDetails = {
  method: 'cash_pickup',
  beneficiary: 'Lou Inventée',
  city: 'Ville fictive',
  note: null,
};

describe('« Où te verser » : le membre écrit, le propriétaire révèle, un manager jamais (ADR 0165)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lou: TeamMember;
  let theoCookie: string;
  let louCookie: string;
  let miaCookie: string;

  const db = () => team.test.admin.db;
  const path = (member: TeamMember) => `/payroll/contractors/${member.id}/payout-destination`;
  const write = (member: TeamMember, cookie: string, body: PutPayoutDetailsBody) =>
    team.call('PUT', path(member), cookie, body);
  const readOwn = (member: TeamMember, cookie: string) => team.call('GET', path(member), cookie);
  const reveal = (member: TeamMember, cookie: string) => team.call('POST', `${path(member)}/reveal`, cookie);
  const staleConfirmations = () =>
    db()
      .update(schema.session)
      .set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
  const freshConfirmations = () =>
    db()
      .update(schema.session)
      .set({ reauthenticatedAt: sql`now()` });
  const RefusalSchema = z.object({ error: z.object({ code: z.string() }) });
  const codeOf = (body: string): string => RefusalSchema.parse(JSON.parse(body)).error.code;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {}, { CREDENTIALS_ENCRYPTION_KEYS: KEYS });
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lou, cookie: louCookie } = await team.addMember('lou@example.test', 'Lou'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
  });

  afterAll(() => team.close());

  it('lets the member write and read his own, sealed, said in the audit log without a value, told to his phone', async () => {
    const empty = await readOwn(theo, theoCookie);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(PayoutDestinationSchema.parse(empty.json())).toEqual({
      memberId: theo.id,
      method: null,
      changedAt: null,
      details: null,
    });

    const created = await write(theo, theoCookie, THEO_MOMO);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const written = PayoutDestinationSchema.parse(created.json());
    // Spaces dropped from the number, the rest as written.
    expect(written.details).toEqual({ ...THEO_MOMO, phone: '+22900000001' });

    // The same details again: nothing written, nothing told.
    const again = await write(theo, theoCookie, THEO_MOMO);
    expect(again.statusCode, again.body).toBe(200);
    const rows = await db()
      .select()
      .from(schema.payoutDestinations)
      .where(eq(schema.payoutDestinations.memberId, theo.id));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (row === undefined) throw new Error('no row');
    expect(row.method).toBe('mobile_money');
    expect(row.detailsCiphertext.toString('utf8')).not.toContain('22900000001');

    const audits = await db()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'payout_destination.update'));
    expect(audits.map((entry) => entry.details)).toEqual([{ method: 'mobile_money', version: row.id }]);
    for (const secret of SECRETS) expect(JSON.stringify(audits)).not.toContain(secret);

    const jobs = await db().execute<{ payload: unknown }>(
      sql`select payload from graphile_worker._private_jobs where key = ${`payroll.notify_payout_change:${row.id}`}`,
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.payload).toMatchObject({
      memberId: theo.id,
      versionId: row.id,
      userId: theo.userId,
    });
  });

  it('never lets the owner, a manager or another member write it for him', async () => {
    for (const cookie of [team.owner, miaCookie]) {
      const refused = await write(theo, cookie, THEO_BANK);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(codeOf(refused.body)).toBe('payout_destination_forbidden');
    }
    expect((await write(theo, louCookie, THEO_BANK)).statusCode).toBe(404);
    // The base says it too: an insert in his name from another account passes no policy.
    await expect(
      team.test.app.db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.user_id', ${team.ownerId}, true), set_config('app.team_scope', 'owner', true)`,
        );
        await tx.insert(schema.payoutDestinations).values({
          id: '0199f2a0-0000-7000-8000-000000000999',
          memberId: theo.id,
          method: 'cash_pickup',
          detailsCiphertext: Buffer.from('x'),
          createdBy: team.ownerId,
        });
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('lists to the owner the way each one receives, never a number; a manager reads nothing', async () => {
    const list = await team.call('GET', '/payroll/payout-destinations', team.owner);
    expect(list.statusCode, list.body).toBe(200);
    const parsed = PayoutDestinationListSchema.parse(list.json());
    expect(parsed.destinations.find((one) => one.memberId === theo.id)).toMatchObject({
      method: 'mobile_money',
    });
    expect(parsed.destinations.find((one) => one.memberId === lou.id)).toEqual({
      memberId: lou.id,
      method: null,
      changedAt: null,
    });
    for (const secret of SECRETS) expect(list.body).not.toContain(secret);

    for (const [url, method] of [
      ['/payroll/payout-destinations', 'GET'],
      [path(theo), 'GET'],
      [`${path(theo)}/reveal`, 'POST'],
    ] as const) {
      const refused = await team.call(method, url, miaCookie);
      expect(refused.statusCode, `${method} ${url} ${refused.body}`).toBe(403);
    }
    // Another member does not even see him (`team_member_not_found`).
    const other = await readOwn(theo, louCookie);
    expect(other.statusCode, other.body).toBe(404);
    // The owner reads another's only by revealing it.
    const notHis = await readOwn(theo, team.owner);
    expect(notHis.statusCode, notHis.body).toBe(403);
  });

  it('reveals one member to the owner with a recent sign-in, journalised without the value', async () => {
    await staleConfirmations();
    const stale = await reveal(theo, team.owner);
    expect(stale.statusCode, stale.body).toBe(403);
    expect(codeOf(stale.body)).toBe('reauthentication_forbidden');
    const staleWrite = await write(theo, theoCookie, THEO_BANK);
    expect(codeOf(staleWrite.body)).toBe('reauthentication_forbidden');
    await freshConfirmations();

    const shown = await reveal(theo, team.owner);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.headers['cache-control']).toBe('private, no-store');
    expect(PayoutDestinationSchema.parse(shown.json()).details).toMatchObject({ phone: '+22900000001' });
    const audits = await db()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'payout_destination.reveal'));
    expect(audits.map((entry) => [entry.userId, entry.entityId, entry.details])).toEqual([
      [team.ownerId, theo.id, {}],
    ]);
  });

  it('does not open a block copied on another member, nor an old version replayed as the newest', async () => {
    const [row] = await db()
      .select()
      .from(schema.payoutDestinations)
      .where(eq(schema.payoutDestinations.memberId, theo.id));
    if (row === undefined) throw new Error('no row');
    await db().insert(schema.payoutDestinations).values({
      id: '0199f2a0-0000-7000-8000-000000000501',
      memberId: lou.id,
      method: row.method,
      detailsCiphertext: row.detailsCiphertext,
      createdBy: lou.userId,
    });
    const copied = await readOwn(lou, louCookie);
    expect(copied.statusCode, copied.body).toBe(503);
    expect(codeOf(copied.body)).toBe('payout_destination_unavailable');
    for (const secret of SECRETS) expect(copied.body).not.toContain(secret);
  });

  it('refuses a change and a deletion in the base, and the service role reads nothing', async () => {
    await expect(
      db()
        .update(schema.payoutDestinations)
        .set({ method: 'cash_pickup' })
        .where(eq(schema.payoutDestinations.memberId, theo.id)),
    ).rejects.toThrow();
    await expect(
      db().delete(schema.payoutDestinations).where(eq(schema.payoutDestinations.memberId, theo.id)),
    ).rejects.toThrow();
    await expect(team.test.service.db.select().from(schema.payoutDestinations)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('allows three changes a day, and refuses the fourth', async () => {
    const bodies: PayoutDetails[] = [
      THEO_BANK,
      { method: 'cash_pickup', beneficiary: 'Théo Inventé', city: 'Ville fictive', note: null },
    ];
    for (const body of bodies) {
      const changed = await write(theo, theoCookie, body);
      expect(changed.statusCode, changed.body).toBe(201);
    }
    const fourth = await write(theo, theoCookie, THEO_MOMO);
    expect(fourth.statusCode, fourth.body).toBe(429);
    expect(codeOf(fourth.body)).toBe('payout_destination_limited');
  });

  it('re-seals with a new key by adding a version, never an update, and says no change', async () => {
    const before = PayoutDestinationListSchema.parse(
      (await team.call('GET', '/payroll/payout-destinations', team.owner)).json(),
    ).destinations.find((one) => one.memberId === theo.id);
    const fresh = `v2:${Buffer.alloc(32, 8).toString('base64')}`;
    const rotated = parseEncryptionKeys(`${fresh},${KEYS}`);
    // Lou's copied block opens with no key: it is named, never guessed.
    expect(await resealPayoutDestinations(db(), rotated)).toEqual({ rewritten: 1, unreadable: [lou.id] });
    expect(await resealPayoutDestinations(db(), rotated)).toEqual({ rewritten: 0, unreadable: [lou.id] });
    expect(await checkPayoutDestinations(db(), parseEncryptionKeys(fresh))).toEqual({
      total: 2,
      unreadable: [lou.id],
    });
    const rows = await db()
      .select()
      .from(schema.payoutDestinations)
      .where(eq(schema.payoutDestinations.memberId, theo.id));
    expect(rows.filter((row) => row.resealed)).toHaveLength(1);
    const after = PayoutDestinationListSchema.parse(
      (await team.call('GET', '/payroll/payout-destinations', team.owner)).json(),
    ).destinations.find((one) => one.memberId === theo.id);
    expect(after).toEqual(before);

    // Lou's version in force opens with no key: Lou can still write it again, and reads it back.
    const rewritten = await write(lou, louCookie, LOU_CASH);
    expect(rewritten.statusCode, rewritten.body).toBe(201);
    const read = await readOwn(lou, louCookie);
    expect(read.statusCode, read.body).toBe(200);
  });

  it('refuses to check or re-seal on a connection that row-level security would leave blind', async () => {
    await expect(checkPayoutDestinations(team.test.app.db, parseEncryptionKeys(KEYS))).rejects.toThrow(
      /lacks BYPASSRLS/u,
    );
    await expect(resealPayoutDestinations(team.test.app.db, parseEncryptionKeys(KEYS))).rejects.toThrow(
      /lacks BYPASSRLS/u,
    );
  });
});

describe('« Où te verser » sans clé de scellement (ADR 0165 § 2)', () => {
  let team: PayrollTeam;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
  });

  afterAll(() => team.close());

  it('keeps nothing unsealed', async () => {
    const { member, cookie } = await team.addMember('noa@example.test', 'Noa');
    const refused = await team.call(
      'PUT',
      `/payroll/contractors/${member.id}/payout-destination`,
      cookie,
      THEO_MOMO,
    );
    expect(refused.statusCode, refused.body).toBe(503);
    expect(await team.test.admin.db.select().from(schema.payoutDestinations)).toEqual([]);
  });
});
