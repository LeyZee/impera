import { createHash } from 'node:crypto';

import {
  calendarDayAt,
  ContractorDocumentKindSchema,
  ContractAcceptanceIdSchema,
  ContractAcceptanceSchema,
  ContractorFileSchema,
  ContractorProfileSchema,
  ContractTextSchema,
  newId,
  TeamMemberIdSchema,
  type ContractAcceptance,
  type ContractorDocument,
  type ContractorFile,
  type ContractorProfileBody,
  type ContractText,
  type TeamMemberId,
} from '@impera/contracts';
import { and, eq, schema, sql, withMember, type Database, type Transaction } from '@impera/db';

import { documentReminderFrom, documentsFollowed, regimeOn } from '../domain/billing';
import { profileChanges } from '../domain/contractors';
import {
  ContractAcceptanceForbidden,
  ContractorProfileChanged,
  ContractorProfileForbidden,
  ContractorProfileNotFound,
  ContractTextChanged,
  ContractTextIdConflict,
  ContractTextNotFound,
  ContractTextSuperseded,
  InvoicePrefixFrozen,
  InvoicePrefixTaken,
  PayrollForbidden,
  TeamMemberNotFound,
} from '../domain/errors';
import type { PayrollContractorStore } from '../domain/ports';

import { audit } from './audit';
import { documentOf } from './document-rows';
import type { ContractorInvoiceReads, ContractorReads, InvoiceRequeue } from './ports';
import { assignmentOf } from './regime-store';

const {
  billingRegimes,
  contractAcceptances,
  contractorDocumentPurges,
  contractorDocumentReviews,
  contractorDocuments,
  contractorProfiles,
  contractorRegimes,
  contractTexts,
  teamMembers,
} = schema;

type ProfileRow = typeof contractorProfiles.$inferSelect;
type TextRow = typeof contractTexts.$inferSelect;

/** The member as the reader's policy lets him see it: the owner and an active manager every one, a member his own. */
interface Member {
  readonly id: TeamMemberId;
  readonly userId: string | null;
  readonly country: string;
  /** A member who left is never reminded (`payroll.remind_documents`). */
  readonly left: boolean;
}

/** What a file needs besides its rows: the agency's day and the owner's delay before a document's last day. */
interface FileDay {
  readonly today: string;
  readonly reminderDays: number;
}

async function memberOf(tx: Transaction, memberId: TeamMemberId): Promise<Member> {
  const [row] = await tx
    .select({ userId: teamMembers.userId, country: teamMembers.country, status: teamMembers.status })
    .from(teamMembers)
    .where(eq(teamMembers.id, memberId));
  if (row === undefined) throw new TeamMemberNotFound();
  return { id: memberId, userId: row.userId, country: row.country, left: row.status === 'left' };
}

/** One write at a time on a file, a prefix, the texts or a contractor's acceptances: each one reads what it changes. */
async function lock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

async function profileOf(tx: Transaction, memberId: TeamMemberId): Promise<ProfileRow | null> {
  const [row] = await tx.select().from(contractorProfiles).where(eq(contractorProfiles.memberId, memberId));
  return row ?? null;
}

/**
 * Changes a file's row and proves it changed: a policy that filters the row (`member_update`, whose `USING` hides it
 * before any trigger runs) updates nothing without an error. A row that does not come back is refused (`refused`),
 * never answered 200 over a write that did not happen, whatever the role checks above it become.
 */
async function updateProfile(
  tx: Transaction,
  memberId: TeamMemberId,
  values: Partial<typeof contractorProfiles.$inferInsert>,
  refused: () => Error,
): Promise<void> {
  const written = await tx
    .update(contractorProfiles)
    .set(values)
    .where(eq(contractorProfiles.memberId, memberId))
    .returning({ memberId: contractorProfiles.memberId });
  if (written.length === 0) throw refused();
}

/** What a write compares: the file as its body would hold it. */
const bodyOf = (row: ProfileRow): ContractorProfileBody => ({
  legalName: row.legalName,
  address: row.address,
  taxId: row.taxId,
  businessId: row.businessId,
  vatNumber: row.vatNumber,
  individualEntrepreneur: row.individualEntrepreneur,
  legalForm: row.legalForm,
  shareCapitalMinor: row.shareCapitalMinor,
  rcsCity: row.rcsCity,
  email: row.email,
});

const textOf = (row: TextRow): ContractText =>
  ContractTextSchema.parse({
    id: row.id,
    kind: row.kind,
    version: row.version,
    body: row.body,
    sha256: row.sha256,
    contestDelayDays: row.contestDelayDays,
    createdAt: row.createdAt.toISOString(),
  });

const acceptanceOf = (row: {
  id: string;
  memberId: string;
  textId: string;
  textSha256: string;
  acceptedAt: Date;
}): ContractAcceptance =>
  ContractAcceptanceSchema.parse({
    id: row.id,
    memberId: row.memberId,
    textId: row.textId,
    sha256: row.textSha256,
    acceptedAt: row.acceptedAt.toISOString(),
  });

/**
 * The first day of each followed document's reminder (lot 8): the documents of the regime in force today, as
 * `payroll.remind_documents` chooses them (`documentsFollowed`), none for a member who left.
 */
async function remindersOf(
  tx: Transaction,
  member: Member,
  regimes: readonly { readonly regimeId: string; readonly effectiveFrom: string }[],
  documents: readonly ContractorDocument[],
  day: FileDay,
): Promise<Map<string, string>> {
  const assignment = regimeOn(
    regimes.map((one) => ({ regimeId: one.regimeId, from: one.effectiveFrom })),
    day.today,
  );
  if (member.left || assignment === null) return new Map();
  const [regime] = await tx
    .select({ documents: billingRegimes.documents })
    .from(billingRegimes)
    .where(eq(billingRegimes.id, assignment.regimeId));
  const asked = {
    documents: (regime?.documents ?? []).map((kind) => ContractorDocumentKindSchema.parse(kind)),
  };
  return new Map(
    documentsFollowed(asked, documents).map((one) => [one.id, documentReminderFrom(one, day.reminderDays)]),
  );
}

async function fileOf(
  tx: Transaction,
  member: Member,
  day: FileDay,
  invoices: ContractorInvoiceReads,
): Promise<ContractorFile> {
  const profile = await profileOf(tx, member.id);
  const accepted = await tx
    .select({ acceptance: contractAcceptances })
    .from(contractAcceptances)
    .innerJoin(contractTexts, eq(contractTexts.id, contractAcceptances.textId))
    .where(eq(contractAcceptances.memberId, member.id))
    .orderBy(contractTexts.kind, sql`${contractTexts.version} desc`);
  const regimes = await tx
    .select()
    .from(contractorRegimes)
    .where(eq(contractorRegimes.memberId, member.id))
    .orderBy(sql`${contractorRegimes.effectiveFrom} desc`);
  const documents = await tx
    .select({ row: contractorDocuments, review: contractorDocumentReviews, purge: contractorDocumentPurges })
    .from(contractorDocuments)
    .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
    .leftJoin(contractorDocumentPurges, eq(contractorDocumentPurges.documentId, contractorDocuments.id))
    .where(eq(contractorDocuments.memberId, member.id))
    .orderBy(sql`${contractorDocuments.createdAt} desc`, sql`${contractorDocuments.id} desc`);
  const filed = documents.map((one) => documentOf(one.row, one.review, one.purge));
  const reminders = await remindersOf(tx, member, regimes, filed, day);
  return ContractorFileSchema.parse({
    memberId: member.id,
    today: day.today,
    country: member.country,
    profile:
      profile === null
        ? null
        : ContractorProfileSchema.parse({
            memberId: profile.memberId,
            ...bodyOf(profile),
            invoicePrefix: profile.invoicePrefix,
            verifiedAt: profile.verifiedAt?.toISOString() ?? null,
            updatedAt: profile.updatedAt.toISOString(),
          }),
    prefixFrozen: await invoices.hasDocument(tx, member.id),
    acceptances: accepted.map((row) => acceptanceOf(row.acceptance)),
    regimes: regimes.map(assignmentOf),
    documents: filed.map((one) => ({ ...one, remindFrom: reminders.get(one.id) ?? null })),
  });
}

/** The prefix and the check are the owner's; the policies `member_update` and the trigger say it again. */
function assertOwner(scope: string): void {
  if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
}

/** The owner's file to change: the member he sees, and his file, which exists. Locked for the rest of the transaction. */
async function ownedProfile(
  tx: Transaction,
  memberId: TeamMemberId,
): Promise<{ member: Member; profile: ProfileRow }> {
  const member = await memberOf(tx, memberId);
  await lock(tx, `contractor_profile:${memberId}`);
  const profile = await profileOf(tx, memberId);
  if (profile === null) throw new ContractorProfileNotFound();
  return { member, profile };
}

/**
 * The contractor's file and texts (EQ-06 lot 5a): see `PayrollContractorStore`. A file's `updated_at` is the base's
 * (its trigger sets it at each change), the instant of a check the module's clock.
 */
export function createDrizzlePayrollContractorStore(
  db: Database,
  reads: ContractorReads,
  documentReminderDays: () => Promise<number>,
  requeue: InvoiceRequeue,
  invoices: ContractorInvoiceReads,
  now: () => Date,
): PayrollContractorStore {
  const dayOf = async (tx: Transaction): Promise<FileDay> => ({
    today: calendarDayAt(now(), await reads.agencyTimeZone(tx)),
    reminderDays: await documentReminderDays(),
  });
  return {
    file: (userId, memberId) =>
      withMember(db, userId, async (tx) =>
        fileOf(tx, await memberOf(tx, memberId), await dayOf(tx), invoices),
      ),

    writeProfile: (actor, memberId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const member = await memberOf(tx, memberId);
        if (scope !== 'owner' && member.userId !== actor.userId) throw new ContractorProfileForbidden();
        await lock(tx, `contractor_profile:${memberId}`);
        const before = await profileOf(tx, memberId);
        const changed = profileChanges(before === null ? null : bodyOf(before), body);
        if (before !== null && changed.length === 0)
          return { file: await fileOf(tx, member, await dayOf(tx), invoices), created: false };
        if (before === null) {
          await tx.insert(contractorProfiles).values({ memberId, ...body, updatedBy: actor.userId });
        } else {
          await updateProfile(
            tx,
            memberId,
            { ...body, updatedBy: actor.userId },
            () => new ContractorProfileForbidden(),
          );
        }
        await audit(
          tx,
          actor,
          before === null ? 'contractor_profile.create' : 'contractor_profile.update',
          { kind: 'contractor_profile', id: memberId },
          // Every field is identity: a change clears the owner's check (the trigger), said here with the fields' names.
          { changed, checkCleared: before?.verifiedAt !== null && before?.verifiedAt !== undefined },
        );
        await requeue.requeue(tx, memberId);
        return { file: await fileOf(tx, member, await dayOf(tx), invoices), created: before === null };
      }),

    verifyProfile: (actor, memberId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        const { member, profile } = await ownedProfile(tx, memberId);
        // Checked already: nothing of the identity changed since, or the trigger would have cleared it.
        if (profile.verifiedAt !== null) return fileOf(tx, member, await dayOf(tx), invoices);
        if (profile.updatedAt.toISOString() !== body.updatedAt) throw new ContractorProfileChanged();
        await updateProfile(
          tx,
          memberId,
          { verifiedAt: now(), verifiedBy: actor.userId, updatedBy: actor.userId },
          () => new PayrollForbidden({ ownerOnly: true }),
        );
        await audit(tx, actor, 'contractor_profile.verify', { kind: 'contractor_profile', id: memberId }, {});
        await requeue.requeue(tx, memberId);
        return fileOf(tx, member, await dayOf(tx), invoices);
      }),

    setPrefix: (actor, memberId, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        const { member, profile } = await ownedProfile(tx, memberId);
        if (profile.invoicePrefix === body.invoicePrefix)
          return fileOf(tx, member, await dayOf(tx), invoices);
        if (await invoices.hasDocument(tx, memberId)) throw new InvoicePrefixFrozen();
        // Two owners' tabs giving one prefix to two contractors: the second waits, then finds it taken.
        await lock(tx, `invoice_prefix:${body.invoicePrefix}`);
        const [holder] = await tx
          .select({ memberId: contractorProfiles.memberId })
          .from(contractorProfiles)
          .where(eq(contractorProfiles.invoicePrefix, body.invoicePrefix));
        if (holder !== undefined) throw new InvoicePrefixTaken();
        await updateProfile(
          tx,
          memberId,
          { invoicePrefix: body.invoicePrefix, updatedBy: actor.userId },
          () => new PayrollForbidden({ ownerOnly: true }),
        );
        await audit(
          tx,
          actor,
          'contractor_profile.prefix',
          { kind: 'contractor_profile', id: memberId },
          { from: profile.invoicePrefix, to: body.invoicePrefix },
        );
        await requeue.requeue(tx, memberId);
        return fileOf(tx, member, await dayOf(tx), invoices);
      }),

    texts: (userId) =>
      withMember(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(contractTexts)
          .orderBy(contractTexts.kind, sql`${contractTexts.version} desc`);
        return { texts: rows.map(textOf) };
      }),

    addText: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwner(scope);
        // One version at a time, of every kind: each takes the next number of its own (the trigger checks it).
        await lock(tx, 'contract_texts');
        const contestDelayDays = body.kind === 'billing_mandate' ? body.contestDelayDays : null;
        const [existing] = await tx.select().from(contractTexts).where(eq(contractTexts.id, body.id));
        if (existing !== undefined) {
          const same =
            existing.kind === body.kind &&
            existing.body === body.body &&
            existing.contestDelayDays === contestDelayDays;
          if (!same) throw new ContractTextIdConflict();
          return { text: textOf(existing), created: false };
        }
        const [last] = await tx
          .select({ version: sql<number | null>`max(${contractTexts.version})` })
          .from(contractTexts)
          .where(eq(contractTexts.kind, body.kind));
        const version = (last?.version ?? 0) + 1;
        const sha256 = createHash('sha256').update(body.body, 'utf8').digest('hex');
        const [row] = await tx
          .insert(contractTexts)
          .values({
            id: body.id,
            kind: body.kind,
            version,
            body: body.body,
            sha256,
            contestDelayDays,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('contract_texts: insert returned no row');
        await audit(
          tx,
          actor,
          'contract_text.add',
          { kind: 'contract_text', id: body.id },
          { kind: body.kind, version, sha256, contestDelayDays },
        );
        return { text: textOf(row), created: true };
      }),

    accept: (actor, textId, body) =>
      withMember(db, actor.userId, async (tx) => {
        // His own member record only: no one accepts for him, the owner neither (policy `member_accept`).
        const [member] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(eq(teamMembers.userId, actor.userId));
        if (member === undefined) throw new ContractAcceptanceForbidden();
        const memberId = TeamMemberIdSchema.parse(member.id);
        const [text] = await tx.select().from(contractTexts).where(eq(contractTexts.id, textId));
        if (text === undefined) throw new ContractTextNotFound();
        await lock(tx, `contract_acceptance:${memberId}`);
        const [existing] = await tx
          .select()
          .from(contractAcceptances)
          .where(and(eq(contractAcceptances.memberId, memberId), eq(contractAcceptances.textId, textId)));
        if (existing !== undefined) return { acceptance: acceptanceOf(existing), created: false };
        if (text.sha256 !== body.sha256) throw new ContractTextChanged();
        const [newest] = await tx
          .select({ version: sql<number | null>`max(${contractTexts.version})` })
          .from(contractTexts)
          .where(eq(contractTexts.kind, text.kind));
        if ((newest?.version ?? text.version) > text.version) throw new ContractTextSuperseded();
        const [row] = await tx
          .insert(contractAcceptances)
          .values({
            id: newId(ContractAcceptanceIdSchema),
            memberId,
            textId,
            textSha256: text.sha256,
            acceptedBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('contract_acceptances: insert returned no row');
        await audit(
          tx,
          actor,
          'contract.accept',
          { kind: 'contract_acceptance', id: row.id },
          { kind: text.kind, version: text.version, sha256: text.sha256 },
        );
        // The mandate is what an invoice waits for; the service contract does not hold one back.
        if (text.kind === 'billing_mandate') await requeue.requeue(tx, memberId);
        return { acceptance: acceptanceOf(row), created: true };
      }),
  };
}
