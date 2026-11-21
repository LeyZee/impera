import { DomainError, ExtensionLinkHolderSchema, UserIdSchema } from '@impera/contracts';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';

import type { LinkHolder } from '../../../domain/ports';
import { createTrendRoutes } from '../routes';

/* Invented codes and people (ADR 0010). */
const CHATTER_CODE = 'c'.repeat(43);
const MANAGER_CODE = 'm'.repeat(43);
const HOLDERS: Readonly<Record<string, LinkHolder>> = {
  [CHATTER_CODE]: {
    userId: UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1'),
    role: 'operator',
    watch: false,
  },
  [MANAGER_CODE]: {
    userId: UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000a1'),
    role: 'operator',
    watch: true,
  },
};

async function serve() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('user', null);
  // The server's handler, cut down: the code is what the extension reads.
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof DomainError ? 418 : 500)
      .send({ code: error instanceof DomainError ? error.code : null }),
  );
  const unused = (): never => {
    throw new Error('not used here');
  };
  await app.register(
    createTrendRoutes(
      {
        signals: { pasteLink: unused },
        links: {
          live: unused,
          create: unused,
          revoke: unused,
          holder: (token) => Promise.resolve(HOLDERS[token] ?? null),
        },
        readings: {
          markable: () => Promise.resolve([]),
          record: unused,
          markedFor: unused,
          describe: unused,
        },
        vision: { describe: unused },
      },
      {
        ideas: { ofDay: unused, validate: unused, refuse: unused, suggested: unused },
        limitsOf: unused,
        suggestShoot: unused,
      },
      () => () => Promise.resolve(),
      () => Promise.resolve(),
    ),
    { prefix: '/v1' },
  );
  return app;
}

const ask = async (url: string, code: string | null) => {
  const app = await serve();
  return app.inject({ method: 'GET', url, headers: code === null ? {} : { 'x-extension-link': code } });
};

describe('GET /v1/trends/extension-links/holder (EXT-01)', () => {
  it('knows a chatter’s code, while the watch’s doors stay closed to him', async () => {
    const holder = await ask('/v1/trends/extension-links/holder', CHATTER_CODE);
    expect(holder.statusCode).toBe(200);
    expect(ExtensionLinkHolderSchema.parse(holder.json())).toEqual({ watch: false });
    const creators = await ask('/v1/trends/readings/creators', CHATTER_CODE);
    expect(creators.json()).toEqual({ code: 'trend_watch_forbidden' });
  });

  it('says the watch is a manager’s, and refuses a code that names nobody', async () => {
    expect((await ask('/v1/trends/extension-links/holder', MANAGER_CODE)).json()).toEqual({ watch: true });
    expect((await ask('/v1/trends/extension-links/holder', 'z'.repeat(43))).json()).toEqual({
      code: 'extension_link_unauthenticated',
    });
    expect((await ask('/v1/trends/extension-links/holder', null)).json()).toEqual({
      code: 'extension_link_unauthenticated',
    });
  });
});
