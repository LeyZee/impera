import {
  AlertsViewSchema,
  CreateCustomAlertBodySchema,
  CustomAlertBodySchema,
  CustomAlertGroupIdSchema,
  CustomAlertGroupSchema,
  DomainError,
  SetSystemAlertBodySchema,
  SystemAlertCodeSchema,
  SystemAlertSettingSchema,
  type AlertErrorCode,
  type UserRole,
} from '@nirvana/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AlertStore } from '../../domain/ports';

const GroupParamsSchema = z.object({ groupId: CustomAlertGroupIdSchema });
const SystemParamsSchema = z.object({ code: SystemAlertCodeSchema });

class CustomAlertNotFound extends DomainError {
  constructor() {
    super('custom_alert_not_found' satisfies AlertErrorCode, 'Alerte introuvable');
  }
}

class CustomAlertConflict extends DomainError {
  constructor() {
    super('custom_alert_conflict' satisfies AlertErrorCode, 'Une autre alerte porte déjà cet identifiant');
  }
}

/** Another active alert of one of its creators has the same name (case, accents and spaces around set aside). */
class CustomAlertNameConflict extends DomainError {
  constructor(creatorIds: readonly string[]) {
    super('custom_alert_name_conflict' satisfies AlertErrorCode, 'Une alerte active porte déjà ce nom', {
      details: { creatorIds },
    });
  }
}

class AlertCreatorInvalid extends DomainError {
  constructor() {
    super('alert_creator_invalid' satisfies AlertErrorCode, 'Une des créatrices de l’alerte n’existe pas');
  }
}

class SystemAlertLocked extends DomainError {
  constructor() {
    super(
      'system_alert_locked_unprocessable' satisfies AlertErrorCode,
      'Les mots-clés d’alerte restent toujours actifs : retire le mot dans la persona',
    );
  }
}

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

/**
 * `/v1/alerts` (P4-01), Réglages › Alertes, the owner's alone. Her own alerts are addressed by their group: `POST`
 * writes one on its creators under the client's id, `PUT /:groupId` replaces it on all of them, `DELETE /:groupId`
 * archives it. `PUT /system/:code` switches a system alert on or off for some creators.
 */
export function createAlertRoutes(store: AlertStore, requireRole: RequireRole): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/alerts',
      { preValidation: requireRole('owner'), schema: { response: { 200: AlertsViewSchema } } },
      () => store.view(),
    );

    app.post(
      '/alerts',
      {
        preValidation: requireRole('owner'),
        schema: {
          body: CreateCustomAlertBodySchema,
          response: { 200: CustomAlertGroupSchema, 201: CustomAlertGroupSchema },
        },
      },
      async (request, reply) => {
        const written = await store.create(request.body, signedIn(request.user));
        if (written.kind === 'unknown_creator') throw new AlertCreatorInvalid();
        if (written.kind === 'conflict') throw new CustomAlertConflict();
        if (written.kind === 'name_conflict') throw new CustomAlertNameConflict(written.creatorIds);
        return reply.code(written.kind === 'created' ? 201 : 200).send(written.alert);
      },
    );

    app.put(
      '/alerts/:groupId',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: GroupParamsSchema,
          body: CustomAlertBodySchema,
          response: { 200: CustomAlertGroupSchema },
        },
      },
      async (request) => {
        const written = await store.replace(request.params.groupId, request.body, signedIn(request.user));
        if (written === 'not_found') throw new CustomAlertNotFound();
        if (written === 'unknown_creator') throw new AlertCreatorInvalid();
        if ('kind' in written) throw new CustomAlertNameConflict(written.creatorIds);
        return written;
      },
    );

    app.delete(
      '/alerts/:groupId',
      { preValidation: requireRole('owner'), schema: { params: GroupParamsSchema } },
      async (request, reply) => {
        if (!(await store.archive(request.params.groupId, signedIn(request.user))))
          throw new CustomAlertNotFound();
        return reply.code(204).send();
      },
    );

    app.put(
      '/alerts/system/:code',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: SystemParamsSchema,
          body: SetSystemAlertBodySchema,
          response: { 200: SystemAlertSettingSchema },
        },
      },
      async (request) => {
        const written = await store.setSystem(request.params.code, request.body, signedIn(request.user));
        if (written === 'locked') throw new SystemAlertLocked();
        if (written === 'unknown_creator') throw new AlertCreatorInvalid();
        return written;
      },
    );
    return Promise.resolve();
  };
}
