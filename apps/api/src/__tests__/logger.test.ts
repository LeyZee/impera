import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger, workerLoggerFrom } from '../logger';

const LineSchema = z.record(z.string(), z.unknown());

/** A logger writing into memory, and the lines it wrote, parsed. */
function memoryLogger(): { logger: ReturnType<typeof createLogger>; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger({ LOG_LEVEL: 'debug' }, destination);
  const lines = (): Record<string, unknown>[] =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => LineSchema.parse(JSON.parse(line)));
  return { logger, lines };
}

/** As Drizzle wraps a driver error: the query and its values in the message, the driver's error in `cause`. */
function drizzleError(): Error {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint "fans_pkey"'), {
    code: '23505',
    detail: 'Key (pseudo)=(FanPseudo) already exists.',
  });
  return Object.assign(
    new Error('Failed query: insert into fans values ($1, $2)\nparams: FanPseudo,limites de la persona', {
      cause: driver,
    }),
    { params: ['FanPseudo', 'limites de la persona'] },
  );
}

describe('logged errors (relecture #584): name, message and code, never someone’s data', () => {
  it('keeps the query without its values, the SQLSTATE and the frames, and nothing else of a database error', () => {
    const { logger, lines } = memoryLogger();
    logger.warn({ err: drizzleError() }, 'a job failed');
    const [line] = lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain('FanPseudo');
    expect(text).not.toContain('limites de la persona');
    const logged = z
      .object({ type: z.string(), message: z.string(), code: z.string(), stack: z.string() })
      .strict()
      .parse(line?.['err']);
    expect(logged).toMatchObject({
      type: 'Error',
      message: 'Failed query: insert into fans values ($1, $2) [SQLSTATE 23505]',
      code: '23505',
    });
    expect(logged.stack).toMatch(/^ {4}at /u);
  });

  it('cuts the values of a query cut by the network, whose cause is no Postgres error (relecture #585)', () => {
    const { logger, lines } = memoryLogger();
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    logger.warn(
      {
        err: new Error('Failed query: select * from fans where pseudo = $1\nparams: FanPseudo', {
          cause: reset,
        }),
      },
      'a job failed',
    );
    const [line] = lines();
    expect(JSON.stringify(line)).not.toContain('FanPseudo');
    expect(line?.['err']).toMatchObject({
      message: 'Failed query: select * from fans where pseudo = $1',
      code: 'ECONNRESET',
    });
  });

  it('keeps a network code, and a name already reduced to a string', () => {
    const { logger, lines } = memoryLogger();
    logger.warn({ err: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }, 'down');
    logger.warn({ err: 'TypeError' }, 'composer failed');
    const [refused, named] = lines();
    expect(refused?.['err']).toMatchObject({
      type: 'Error',
      message: 'connect ECONNREFUSED',
      code: 'ECONNREFUSED',
    });
    expect(named?.['err']).toBe('TypeError');
  });

  it('keeps of a Graphile job what places it, never its payload, and reduces its error the same way', () => {
    const { logger, lines } = memoryLogger();
    const job = {
      id: '42',
      task_identifier: 'conversation.record_facts',
      attempts: 1,
      max_attempts: 3,
      payload: { source: { kind: 'operator_note', note: 'Il aime qu’on l’appelle FanPseudo' } },
    };
    const worker = workerLoggerFrom(logger);
    worker.info('Completed task 42 with success', { job, success: true });
    worker.error('Failed task 42', { failure: true, job, error: drizzleError() });
    const text = JSON.stringify(lines());
    expect(text).not.toContain('FanPseudo');
    expect(text).not.toContain('limites de la persona');
    const [completed, failed] = lines();
    expect(completed?.['job']).toEqual({
      id: '42',
      task: 'conversation.record_facts',
      attempts: 1,
      maxAttempts: 3,
    });
    expect(failed?.['error']).toMatchObject({ code: '23505' });
  });
});

describe('logged requests (relecture #746): the MCP server’s door without its query', () => {
  it('writes /v1/mcp without what follows « ? », and keeps the query elsewhere', async () => {
    const { logger, lines } = memoryLogger();
    const app = Fastify({ loggerInstance: logger });
    app.post('/v1/mcp', () => ({}));
    app.get('/v1/other', () => ({}));
    await app.inject({ method: 'POST', url: '/v1/mcp?access_token=impmcp_inventé', payload: {} });
    await app.inject({ method: 'GET', url: '/v1/other?page=2' });
    await app.close();
    const urls = lines()
      .map((line) => LineSchema.safeParse(line['req']))
      .flatMap((req) => (req.success ? [req.data['url']] : []));
    expect(urls).toEqual(['/v1/mcp', '/v1/other?page=2']);
    expect(JSON.stringify(lines())).not.toContain('impmcp_');
  });
});
