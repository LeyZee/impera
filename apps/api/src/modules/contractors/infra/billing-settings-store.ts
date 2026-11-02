import { createHash } from 'node:crypto';

import {
  AgencyLogoMediaTypeSchema,
  BillingSettingsViewSchema,
  DEFAULT_DOCUMENT_REMINDER_DAYS,
  InvoiceAgencySchema,
  JOURNAL_ACCOUNT_NAMES,
  JournalAccountsSchema,
  type AgencyLogo,
  type BillingSettingsView,
  type UpdateBillingSettingsBody,
} from '@nirvana/contracts';
import { eq, schema, withMember, type Transaction, type Database } from '@nirvana/db';

import { AgencyLogoNotFound, BillingSettingsMissing, PayrollForbidden } from '../domain/errors';
import type { PayrollBillingSettingsStore } from '../domain/ports';

import { audit } from './audit';
import { pngSize } from './png';
import type { InvoiceRequeue } from './ports';

const { agencyLogos, billingSettings } = schema;

/** The settings' single row (`billing_settings_single_check`). */
const ROW = 1;

/** Réglages › Facturation is the owner's alone; the policies `owner_insert` and `owner_update` say it again. */
function assertOwner(scope: string): void {
  if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
}

async function logoOf(tx: Transaction, sha256: string): Promise<AgencyLogo | null> {
  const [row] = await tx.select().from(agencyLogos).where(eq(agencyLogos.sha256, sha256));
  if (row === undefined) return null;
  return {
    sha256: row.sha256,
    mediaType: AgencyLogoMediaTypeSchema.parse(row.mediaType),
    ...pngSize(row.bytes),
    byteLength: row.bytes.length,
  };
}

async function viewOf(tx: Transaction): Promise<BillingSettingsView> {
  const [row] = await tx.select().from(billingSettings).where(eq(billingSettings.id, ROW));
  if (row === undefined) return { settings: null, logo: null };
  return BillingSettingsViewSchema.parse({
    settings: {
      agency: row.agency,
      paymentTerms: row.paymentTerms,
      dueDays: row.dueDays,
      documentReminderDays: row.documentReminderDays,
      fiscalYearEndMonth: row.fiscalYearEndMonth,
      serviceDescription: row.serviceDescription,
      logoSha256: row.logoSha256,
      accounts: row.accounts,
      updatedAt: row.updatedAt.toISOString(),
    },
    logo: row.logoSha256 === null ? null : await logoOf(tx, row.logoSha256),
  });
}

/** What a save may change, as the row holds it. */
interface Saved {
  readonly agency: Readonly<Record<string, unknown>>;
  readonly serviceDescription: string | null;
  readonly paymentTerms: string;
  readonly dueDays: number;
  readonly fiscalYearEndMonth: number;
  readonly logoSha256: string | null;
  readonly documentReminderDays: number;
}

/**
 * The names of what `body` changes, `agency.<field>` for the agency's: the audit log keeps who changed which setting,
 * never a copy of the values (they are the next invoices').
 */
function changesOf(before: Saved | null, body: UpdateBillingSettingsBody): string[] {
  const agency = Object.entries(body.agency)
    .filter(([key, value]) => before?.agency[key] !== value)
    .map(([key]) => `agency.${key}`)
    .sort();
  const others = (
    ['serviceDescription', 'paymentTerms', 'dueDays', 'fiscalYearEndMonth', 'logoSha256'] as const
  ).filter((key) => before?.[key] !== body[key]);
  // The reminder delay, when sent: omitted, it is kept (lot 8).
  const reminder =
    body.documentReminderDays !== undefined && before?.documentReminderDays !== body.documentReminderDays
      ? (['documentReminderDays'] as const)
      : [];
  return [...agency, ...others, ...reminder];
}

/** Réglages › Facturation (EQ-06): see `PayrollBillingSettingsStore`. */
export function createDrizzlePayrollBillingSettingsStore(
  db: Database,
  requeue: InvoiceRequeue,
  now: () => Date,
): PayrollBillingSettingsStore {
  return {
    read: (userId) =>
      withMember(db, userId, async (tx, scope) => {
        assertOwner(scope);
        return viewOf(tx);
      }),

    update: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        if (body.logoSha256 !== null && (await logoOf(tx, body.logoSha256)) === null) {
          throw new AgencyLogoNotFound();
        }
        // The row locked, two saves one after the other: each one's audit line says what it changed.
        const [row] = await tx
          .select()
          .from(billingSettings)
          .where(eq(billingSettings.id, ROW))
          .for('update');
        const before: Saved | null =
          row === undefined
            ? null
            : {
                agency: InvoiceAgencySchema.parse(row.agency),
                serviceDescription: row.serviceDescription,
                paymentTerms: row.paymentTerms,
                dueDays: row.dueDays,
                fiscalYearEndMonth: row.fiscalYearEndMonth,
                logoSha256: row.logoSha256,
                documentReminderDays: row.documentReminderDays,
              };
        const changed = changesOf(before, body);
        if (changed.length === 0) return viewOf(tx);
        const values = {
          agency: body.agency,
          serviceDescription: body.serviceDescription,
          paymentTerms: body.paymentTerms,
          dueDays: body.dueDays,
          fiscalYearEndMonth: body.fiscalYearEndMonth,
          logoSha256: body.logoSha256,
          ...(body.documentReminderDays !== undefined && { documentReminderDays: body.documentReminderDays }),
          updatedBy: actor.userId,
          updatedAt: now(),
        };
        if (row === undefined) {
          // The first save: the reminder delay takes its default unless sent, the accounts wait for the accountant (lot 7).
          await tx
            .insert(billingSettings)
            .values({
              id: ROW,
              documentReminderDays: DEFAULT_DOCUMENT_REMINDER_DAYS,
              ...values,
              accounts: null,
            })
            .onConflictDoUpdate({ target: billingSettings.id, set: values });
        } else {
          await tx.update(billingSettings).set(values).where(eq(billingSettings.id, ROW));
        }
        await audit(
          tx,
          actor,
          'billing_settings.update',
          { kind: 'billing_settings', id: String(ROW) },
          {
            changed,
          },
        );
        // Saved settings may be what every waiting invoice lacked (`agency_missing`): each one is tried again. The
        // reminder delay alone never lets an invoice go out; `payroll.remind_documents` reads it at its next run.
        if (changed.some((name) => name !== 'documentReminderDays')) await requeue.requeue(tx, null);
        return viewOf(tx);
      }),

    addLogo: (actor, bytes, size) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const inserted = await tx
          .insert(agencyLogos)
          .values({ sha256, mediaType: 'image/png', bytes: Buffer.from(bytes), createdBy: actor.userId })
          .onConflictDoNothing()
          .returning({ sha256: agencyLogos.sha256 });
        const created = inserted.length > 0;
        if (created) {
          await audit(
            tx,
            actor,
            'agency_logo.add',
            { kind: 'agency_logo', id: sha256 },
            {
              width: size.width,
              height: size.height,
              byteLength: bytes.length,
            },
          );
        }
        return {
          logo: { sha256, mediaType: 'image/png', ...size, byteLength: bytes.length },
          created,
        };
      }),

    updateAccounts: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        const [row] = await tx
          .select({ accounts: billingSettings.accounts })
          .from(billingSettings)
          .where(eq(billingSettings.id, ROW))
          .for('update');
        if (row === undefined) throw new BillingSettingsMissing();
        const before = row.accounts === null ? null : JournalAccountsSchema.parse(row.accounts);
        // The names of what changed, never the accounts themselves.
        const changed = JOURNAL_ACCOUNT_NAMES.filter((name) => (before?.[name] ?? null) !== body[name]);
        if (changed.length === 0 && before !== null) return viewOf(tx);
        await tx
          .update(billingSettings)
          .set({ accounts: body, updatedBy: actor.userId, updatedAt: now() })
          .where(eq(billingSettings.id, ROW));
        await audit(
          tx,
          actor,
          'billing_settings.accounts',
          { kind: 'billing_settings', id: String(ROW) },
          { changed },
        );
        return viewOf(tx);
      }),

    logoBytes: (userId, sha256) =>
      withMember(db, userId, async (tx, scope) => {
        assertOwner(scope);
        const [row] = await tx
          .select({ bytes: agencyLogos.bytes })
          .from(agencyLogos)
          .where(eq(agencyLogos.sha256, sha256));
        return row === undefined ? null : new Uint8Array(row.bytes);
      }),
  };
}
