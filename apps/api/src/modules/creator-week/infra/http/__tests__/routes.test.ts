import { CreatorIdSchema, WeekPlanSchema, type AgencyCreatorWeek } from '@impera/contracts';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';

import type { WeekDraftStore } from '../../../domain/ports';
import { createWeekRoutes, type WeekRoutesDeps } from '../routes';

/* An invented creator (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000001');

async function serve(read: WeekDraftStore['read']) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('user', null);
  const unused = (): never => {
    throw new Error('not used here');
  };
  const deps: WeekRoutesDeps = {
    drafts: {
      read,
      creators: unused,
      saveDraft: unused,
      forValidation: unused,
      markValidated: unused,
    },
    days: { read: unused, write: unused, teamDays: unused },
    agenda: { suggestWeek: unused, herWeek: unused, tickLine: unused, teamWeek: unused },
    accept: unused,
    facts: { arrivals: unused, teamArrivals: unused },
    requireRole: () => (request) => {
      request.user = {
        id: 'owner-1',
        email: 'owner@example.test',
        name: 'Owner',
        role: 'owner',
        creatorIds: [CREATOR],
        routedCreatorIds: [],
        shiftCreatorIds: [],
      };
      return Promise.resolve();
    },
  };
  await app.register(createWeekRoutes(deps), { prefix: '/v1' });
  return app;
}

describe('GET /v1/creators/:creatorId/weeks/:week', () => {
  it('answers 204 while her week is not computed yet (MAN-08, DS-14)', async () => {
    const app = await serve(() => Promise.resolve(null));
    const response = await app.inject({ method: 'GET', url: `/v1/creators/${CREATOR}/weeks/2026-11-16` });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('answers her week once computed', async () => {
    const week: AgencyCreatorWeek = {
      week: '2026-11-16',
      state: 'draft',
      plan: WeekPlanSchema.parse({
        shootDays: [
          {
            day: '2026-11-18',
            items: [
              { need: 'feed_shoot', label: 'Séance A', sheet: null, minutes: 45, count: 1, requestId: null },
            ],
          },
        ],
        deferred: [],
        dueAt: '2026-11-22T22:00:00.000Z',
        stock: { sessions: 0, videos: 0, stories: 0 },
        capacityMinutes: 240,
      }),
      computedAt: '2026-11-15T17:00:00.000Z',
      validatedAt: null,
    };
    const app = await serve(() => Promise.resolve(week));
    const response = await app.inject({ method: 'GET', url: `/v1/creators/${CREATOR}/weeks/2026-11-16` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(week);
  });
});
