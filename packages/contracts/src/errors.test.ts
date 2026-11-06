import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ApiErrorSchema,
  DomainError,
  ErrorCodeSchema,
  HTTP_ERROR_CODES,
  RefusalError,
  refusalBodySchema,
  refusalOf,
} from './errors';

describe('DomainError', () => {
  it('gives a domain error its code and subclass name', () => {
    class ConversationNotFound extends DomainError {}
    const error = new ConversationNotFound('conversation_not_found', 'no such conversation', { cause: 'x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConversationNotFound');
    expect(error.code).toBe('conversation_not_found');
    expect(error.cause).toBe('x');
  });
});

describe('error codes', () => {
  it('accepts snake_case codes only', () => {
    for (const code of HTTP_ERROR_CODES) expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    expect(ErrorCodeSchema.safeParse('NotFound').success).toBe(false);
    expect(ErrorCodeSchema.safeParse('not-found').success).toBe(false);
  });

  it('describes the single error body', () => {
    const body = {
      error: { code: 'route_not_found', message: 'Route introuvable', details: {}, requestId: 'r1' },
    };
    expect(ApiErrorSchema.parse(body)).toEqual(body);
    expect(ApiErrorSchema.safeParse({ error: { code: 'x' } }).success).toBe(false);
  });
});

describe('refusals in the common body (MOT-13)', () => {
  const Body = refusalBodySchema(z.enum(['too_short', 'unauthorized']));

  it('puts the kind in the details and the sentence in the message', () => {
    const error = new RefusalError('provider_key_unprocessable', {
      kind: 'too_short',
      message: 'Clé coupée.',
    });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('provider_key_unprocessable');
    expect(error.message).toBe('Clé coupée.');
    expect(error.details).toEqual({ kind: 'too_short' });
  });

  it('reads back the kind and the sentence, and refuses the old bare shape or an unknown kind', () => {
    const body = Body.parse({
      error: {
        code: 'provider_key_unprocessable',
        message: 'Clé coupée.',
        details: { kind: 'too_short' },
        requestId: 'r1',
      },
    });
    expect(ApiErrorSchema.safeParse(body).success).toBe(true);
    expect(refusalOf(body)).toEqual({ kind: 'too_short', message: 'Clé coupée.' });
    expect(Body.safeParse({ kind: 'too_short', message: 'Clé coupée.' }).success).toBe(false);
    const unknown = {
      error: { code: 'x_unprocessable', message: 'm', details: { kind: 'other' }, requestId: 'r' },
    };
    expect(Body.safeParse(unknown).success).toBe(false);
  });
});
