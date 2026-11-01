import {
  alertTriggerReason,
  AlertTriggerItemSchema,
  AlertTriggerQuerySchema,
  AlertTriggerSeenParamsSchema,
  CreatorIdSchema,
  CustomAlertGroupIdSchema,
  DomainError,
  MarkAlertTriggersSeenBodySchema,
  MarkAlertTriggersSeenResultSchema,
  pageOf,
  SYSTEM_ALERT_LABELS,
  SystemAlertCodeSchema,
  type AlertHistoryErrorCode,
  type AlertTriggerItem,
  type CreatorId,
  type CustomAlertGroupId,
  type SystemAlertCode,
} from '@nirvana/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AlertHistory, AlertNames, AlertTriggerFilter, AlertTriggerRow } from '../../domain/ports';

import { actorFor, type RequireRole } from './routes';

class AlertTriggerNotFound extends DomainError {
  constructor() {
    super('alert_trigger_not_found' satisfies AlertHistoryErrorCode, 'Déclenchement d’alerte introuvable');
  }
}

/**
 * The list's `alert` filter as the journal has it: her alert by the id of her row, the system's by its code, and
 * `none` for an alert that never watched her (nothing of hers to show).
 */
function alertFilter(
  alert: CustomAlertGroupId | SystemAlertCode | undefined,
  known: Awaited<ReturnType<AlertNames['ofCreator']>>,
): AlertTriggerFilter['alert'] {
  if (alert === undefined) return undefined;
  const group = CustomAlertGroupIdSchema.safeParse(alert);
  if (!group.success) return { kind: 'system', code: SystemAlertCodeSchema.parse(alert) };
  const id = [...known].find(([, one]) => one.groupId === group.data)?.[0];
  return id === undefined ? { kind: 'none' } : { kind: 'custom', id };
}

/** What the screen reads of a trigger: her alert named as it was, and the line written by the code. */
function itemOf(
  creatorId: CreatorId,
  row: AlertTriggerRow,
  names: Awaited<ReturnType<AlertNames['ofCreator']>>,
): AlertTriggerItem {
  const { alert } = row.trigger;
  const custom = alert.kind === 'custom' ? names.get(alert.id) : undefined;
  // A custom alert always has its row (archived, never deleted); the fallback only keeps the line readable.
  const alertName =
    alert.kind === 'system' ? SYSTEM_ALERT_LABELS[alert.code] : (custom?.name ?? 'Alerte personnalisée');
  return {
    id: row.id,
    creatorId,
    conversationId: row.conversationId,
    fanId: row.fanId,
    fanDisplayName: row.fanDisplayName,
    trigger: row.trigger,
    alertGroupId: custom?.groupId ?? null,
    alertName,
    pausedAgent: row.pausedAgent,
    reason: alertTriggerReason(row.trigger, alertName),
    at: row.at.toISOString(),
    seenAt: row.seenAt?.toISOString() ?? null,
  };
}

/**
 * `/v1/alerts/triggers` (P4-01): the history of her alerts, a sub-view of the Suivi (ADR 0024), for whoever reads the
 * whole creator (the owner, an operator of her `creatorIds`); never through routing alone, never the creator herself.
 */
export function createAlertHistoryRoutes(
  history: AlertHistory,
  names: AlertNames,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    const read = { preValidation: requireRole('owner', 'operator') };

    app.get(
      '/alerts/triggers',
      {
        ...read,
        schema: { querystring: AlertTriggerQuerySchema, response: { 200: pageOf(AlertTriggerItemSchema) } },
      },
      async (request) => {
        const { creatorId, seen, alert, limit, cursor } = request.query;
        actorFor(request, creatorId);
        const known = await names.ofCreator(creatorId);
        const page = await history.list(
          creatorId,
          { seen, alert: alertFilter(alert, known) },
          { limit, cursor },
        );
        return { items: page.items.map((row) => itemOf(creatorId, row, known)), nextCursor: page.nextCursor };
      },
    );

    app.post(
      '/alerts/triggers/:id/seen',
      {
        ...read,
        schema: {
          params: AlertTriggerSeenParamsSchema,
          querystring: z.object({ creatorId: CreatorIdSchema }),
        },
      },
      async (request, reply) => {
        const { userId } = actorFor(request, request.query.creatorId);
        if (!(await history.markSeen(request.query.creatorId, request.params.id, userId))) {
          throw new AlertTriggerNotFound();
        }
        return reply.code(204).send();
      },
    );

    app.post(
      '/alerts/triggers/seen',
      {
        ...read,
        schema: {
          body: MarkAlertTriggersSeenBodySchema,
          response: { 200: MarkAlertTriggersSeenResultSchema },
        },
      },
      async (request) => {
        const { creatorId, untilId, alert } = request.body;
        const { userId } = actorFor(request, creatorId);
        const marked = await history.markSeenUntil(
          creatorId,
          untilId,
          { alert: alertFilter(alert, await names.ofCreator(creatorId)) },
          userId,
        );
        if (marked === null) throw new AlertTriggerNotFound();
        return { marked };
      },
    );

    return Promise.resolve();
  };
}
