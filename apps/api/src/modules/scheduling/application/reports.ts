import {
  DomainError,
  ShiftReportErrorCodeSchema,
  type CreateShiftReportBodySchema,
  type CreatorId,
  type CreatorSummary,
  type RejectShiftReportBody,
  type ShiftId,
  type ShiftReport,
  type ShiftReportContext,
  type ShiftReportId,
  type ShiftReportList,
  type ShiftReportQuery,
  type UpdateShiftReportBodySchema,
  type UserId,
  type ValidateShiftReportsBody,
  type ValidateShiftReportsResult,
} from '@nirvana/contracts';
import type { z } from 'zod';

import { ShiftReportForbidden } from '../domain/errors';
import type { Actor, ShiftReportStore } from '../domain/ports';
import { isAgency, reportOpensAt } from '../domain/reports';

import { toPlanningAccount, toPlanningMember, toShiftDto, toShiftReportDto } from './dto';

/**
 * End-of-shift reports (EQ-03, ADR 0023): the shift's member declares what the shift brought in, the owner or an
 * active manager validates it or sends it back, and a validated report is corrected, never changed.
 */
export interface ShiftReportService {
  context(actor: UserId, shiftId: ShiftId): Promise<ShiftReportContext>;
  /** `created` is false when the same report was already recorded (the route answers 200). */
  create(
    actor: Actor,
    body: z.output<typeof CreateShiftReportBodySchema>,
  ): Promise<{ report: ShiftReport; created: boolean }>;
  update(
    actor: Actor,
    id: ShiftReportId,
    body: z.output<typeof UpdateShiftReportBodySchema>,
  ): Promise<ShiftReport>;
  /** Each report in a transaction of its own, in the order sent; a refusal does not stop the others. */
  validate(actor: Actor, body: ValidateShiftReportsBody): Promise<ValidateShiftReportsResult>;
  reject(actor: Actor, id: ShiftReportId, body: RejectShiftReportBody): Promise<ShiftReport>;
  list(actor: UserId, query: ShiftReportQuery): Promise<ShiftReportList>;
}

export function createShiftReportService(
  store: ShiftReportStore,
  creators: { list(): Promise<readonly CreatorSummary[]> },
  now: () => Date = () => new Date(),
): ShiftReportService {
  const names = async (): Promise<ReadonlyMap<string, CreatorSummary>> =>
    new Map((await creators.list()).map((creator) => [creator.id, creator]));
  const everyCreator = async (): Promise<CreatorId[]> => (await creators.list()).map((creator) => creator.id);

  return {
    context: async (actor, shiftId) => {
      const read = await store.context(actor, shiftId);
      return {
        shift: toShiftDto(read.shift),
        account: toPlanningAccount(read.account, await names()),
        period: read.period,
        opensAt: reportOpensAt(read.shift).toISOString(),
        rules:
          read.rules === null
            ? null
            : { currency: read.rules.currency, earningsSource: read.rules.earningsSource },
        reports: read.reports.map((report) => toShiftReportDto(report, read.reader)),
      };
    },

    create: async (actor, body) => {
      const { report, created, reader } = await store.create(actor, body, now());
      return { report: toShiftReportDto(report, reader), created };
    },

    update: async (actor, id, { version, ...change }) => {
      const { report, reader } = await store.update(actor, id, version, change, now());
      return toShiftReportDto(report, reader);
    },

    validate: async (actor, body) => {
      // Someone who may never review is told once, not once per report.
      if (!isAgency(await store.reader(actor.userId))) throw new ShiftReportForbidden();
      const results: ValidateShiftReportsResult['results'] = [];
      for (const item of body.reports) {
        try {
          const { report, reader } = await store.review(
            actor,
            item.id,
            item.version,
            { decision: 'validate' },
            now(),
          );
          results.push({ outcome: 'validated', report: toShiftReportDto(report, reader) });
        } catch (error) {
          const code = error instanceof DomainError ? ShiftReportErrorCodeSchema.safeParse(error.code) : null;
          if (code?.success !== true) throw error;
          results.push({ outcome: 'refused', id: item.id, code: code.data });
        }
      }
      return { results };
    },

    reject: async (actor, id, body) => {
      const { report, reader } = await store.review(
        actor,
        id,
        body.version,
        { decision: 'reject', note: body.note },
        now(),
      );
      return toShiftReportDto(report, reader);
    },

    list: async (actor, query) => {
      const read = await store.list(actor, await everyCreator(), query.period ?? null, now());
      const creatorNames = await names();
      return {
        reports: read.reports.map((report) => toShiftReportDto(report, read.reader)),
        shifts: read.shifts.map(toShiftDto),
        accounts: read.accounts.map((account) => toPlanningAccount(account, creatorNames)),
        members: read.members.map(toPlanningMember),
      };
    },
  };
}
