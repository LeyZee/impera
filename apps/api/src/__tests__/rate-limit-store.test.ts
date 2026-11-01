import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { postgresRateLimitStore, type RateLimitDb } from '../rate-limit-store';

const unreachable: RateLimitDb = { execute: () => Promise.reject(new Error('connection refused')) };

/** A Fastify with the plugin on the store, as `buildServer` mounts it. */
async function serverWith(db: RateLimitDb, warnings: unknown[] = []) {
  const app = Fastify();
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    store: postgresRateLimitStore({ db, logger: { warn: (object: unknown) => void warnings.push(object) } }),
  });
  return app;
}

describe('rate limit store namespaces', () => {
  it('gives each pair of bounds its own counters, a window given in words included', async () => {
    const app = await serverWith(unreachable);
    expect(() => {
      app.createRateLimit({ max: 10, timeWindow: '15 minutes' });
      app.createRateLimit({ max: 10, timeWindow: '1 minute' });
      app.createRateLimit({ max: 20, timeWindow: '15 minutes' });
    }).not.toThrow();
  });

  it('stops the boot when two limiters would share their counters', async () => {
    const app = await serverWith(unreachable);
    app.createRateLimit({ max: 10, timeWindow: '15 minutes' });
    expect(() => app.createRateLimit({ max: 10, timeWindow: 900_000 })).toThrow(
      /share the counters "limiter 10\/900000"/,
    );
    app.createRateLimit({ max: () => 5, timeWindow: 60_000 });
    expect(() => app.createRateLimit({ max: () => 6, timeWindow: 60_000 })).toThrow(
      /limiter computed\/60000/,
    );
  });

  it('names a route limiter after its route', async () => {
    const app = await serverWith(unreachable);
    const config = { rateLimit: { max: 5, timeWindow: '1 minute' } };
    app.post('/a', { config }, () => 'a');
    app.post('/b', { config }, () => 'b');
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('keeps one server’s namespaces apart from another’s', async () => {
    (await serverWith(unreachable)).createRateLimit({ max: 10, timeWindow: '15 minutes' });
    const other = await serverWith(unreachable);
    expect(() => other.createRateLimit({ max: 10, timeWindow: '15 minutes' })).not.toThrow();
  });
});

describe('rate limit store failures', () => {
  it('logs the limiter, never the client, and hands the plugin a 503', async () => {
    const warnings: unknown[] = [];
    const app = await serverWith(unreachable, warnings);
    const limiter = app.createRateLimit({
      max: 10,
      timeWindow: '15 minutes',
      keyGenerator: () => 'someone@example.test',
    });
    app.get('/probe', { config: { rateLimit: false } }, async (request) => limiter(request));
    const response = await app.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(503);
    expect(warnings).toEqual([expect.objectContaining({ limiter: 'limiter 10/900000' })]);
    expect(JSON.stringify(warnings)).not.toContain('someone@example.test');
  });

  it('treats a counter that does not come back as a failure', async () => {
    const app = await serverWith({ execute: () => Promise.resolve({ rows: [], rowCount: 0 }) });
    const limiter = app.createRateLimit({ max: 10, timeWindow: '15 minutes' });
    app.get('/probe', { config: { rateLimit: false } }, async (request) => limiter(request));
    expect((await app.inject({ method: 'GET', url: '/probe' })).statusCode).toBe(503);
  });
});
