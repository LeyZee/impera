import { describe, expect, it } from 'vitest';

import {
  isDatabaseUnavailable,
  isMissingReference,
  jsonWithoutNul,
  postgresCode,
  storableError,
  withoutNul,
} from '../database-errors';

/** As Drizzle wraps a driver error: the query and its parameters in the message, the driver's error in `cause`. */
function drizzleError(code: string, params = 'Fan\u0000Nul,secret', detail = ''): Error {
  const driver = Object.assign(new Error('driver says no'), { code, detail });
  return new Error(`Failed query: insert into fans values ($1, $2)\nparams: ${params}`, { cause: driver });
}

describe('database errors (recette 05/11)', () => {
  it('reads the SQLSTATE through the wrapping', () => {
    expect(postgresCode(drizzleError('23503'))).toBe('23503');
    expect(postgresCode(new Error('plain'))).toBeUndefined();
  });

  it('tells a database that cannot answer from a wrong request', () => {
    expect(isDatabaseUnavailable(drizzleError('57P01'))).toBe(true);
    expect(isDatabaseUnavailable(drizzleError('08006'))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isDatabaseUnavailable(drizzleError('23505'))).toBe(false);
    // An outside provider that refuses the connection is not the database (relecture #538).
    const fetchFailed = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    expect(isDatabaseUnavailable(fetchFailed)).toBe(false);
  });

  it('calls a reference missing only when the id sent points at nothing, not when a delete is still referenced', () => {
    const missing = drizzleError('23503', '', 'Key (creator_id)=(x) is not present in table "creators".');
    const stillReferenced = drizzleError(
      '23503',
      '',
      'Key (id)=(x) is still referenced from table "shifts".',
    );
    expect(isMissingReference(missing)).toBe(true);
    expect(isMissingReference(stillReferenced)).toBe(false);
    expect(isMissingReference(drizzleError('23505'))).toBe(false);
  });

  it('drops U+0000 from every string of a JSON value, keys included', () => {
    expect(withoutNul('a\u0000b\u0000')).toBe('ab');
    expect(jsonWithoutNul({ 'k\u0000': ['x\u0000', 1, null, { y: 'z\u0000' }], n: true })).toEqual({
      k: ['x', 1, null, { y: 'z' }],
      n: true,
    });
    const bytes = Buffer.from('a\u0000b');
    expect(jsonWithoutNul(bytes)).toBe(bytes);
  });

  it('gives the job runner and the logs an error without U+0000 nor SQL parameters', () => {
    const safe = storableError(drizzleError('23505'));
    expect(safe.message).toBe('Failed query: insert into fans values ($1, $2) [SQLSTATE 23505]');
    expect(safe.message).not.toContain('secret');
    expect(safe.stack ?? '').not.toContain('secret');
    expect(safe).not.toHaveProperty('params');

    expect(storableError(new Error('bad\u0000text')).message).toBe('badtext');
    const plain = new Error('nothing to hide');
    expect(storableError(plain)).toBe(plain);
  });
});
