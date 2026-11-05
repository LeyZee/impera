/**
 * What the HTTP layer and the jobs need to know about an error that came from Postgres, wherever the driver or
 * Drizzle wrapped it (`DrizzleQueryError` keeps the driver's error in `cause`). Recette of 05/11, MOT-01 and
 * MOT-05 to MOT-07.
 */

const MAX_CAUSES = 5;

// Postgres SQLSTATE classes and codes that mean « the database cannot answer right now », not « the request is
// wrong »: connection exceptions (08), admin or crash shutdown (57P01 to 57P03), too many connections (53300).
const UNAVAILABLE_SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300']);
const UNAVAILABLE_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);
// node-postgres says these in words only.
const UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'Client has encountered a connection error',
];

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAX_CAUSES) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** The SQLSTATE of the first Postgres error in the chain, if any. */
export function postgresCode(error: unknown): string | undefined {
  for (const link of causes(error)) {
    const code = codeOf(link);
    if (code !== undefined && /^[0-9A-Z]{5}$/u.test(code)) return code;
  }
  return undefined;
}

/** The database is down, restarting or out of connections: 503 and retry, never 500. */
export function isDatabaseUnavailable(error: unknown): boolean {
  return causes(error).some((link) => {
    const code = codeOf(link);
    if (code !== undefined && (code.startsWith('08') || UNAVAILABLE_SQLSTATES.has(code))) return true;
    if (code !== undefined && UNAVAILABLE_NODE_CODES.has(code)) return true;
    return link instanceof Error && UNAVAILABLE_MESSAGES.some((message) => link.message.includes(message));
  });
}

/** A foreign key pointed at a row that does not exist: an id the client sent is unknown. */
export function isMissingReference(error: unknown): boolean {
  return postgresCode(error) === '23503';
}

/**
 * U+0000, which Postgres refuses in any text value (`invalid byte sequence for encoding "UTF8": 0x00`). It carries
 * no meaning in a message or a name, so the API drops it from what it is given (CLAUDE.md rule 4: a fan's message is
 * data and must never stop the engine).
 */
// eslint-disable-next-line no-control-regex -- the control character is the point
const NUL = /\u0000/gu;

export function withoutNul(text: string): string {
  return text.includes('\u0000') ? text.replace(NUL, '') : text;
}

/** A copy of a JSON value with U+0000 dropped from every string, keys included. */
export function jsonWithoutNul(value: unknown): unknown {
  if (typeof value === 'string') return withoutNul(value);
  if (Array.isArray(value)) return value.map(jsonWithoutNul);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [withoutNul(key), jsonWithoutNul(inner)]),
    );
  }
  return value;
}

/**
 * An error safe to hand to the job runner and to the logs: U+0000 dropped from its message (Graphile stores the
 * message in a text column and would fail on it, killing the process, MOT-01), and no SQL parameters (Drizzle
 * copies them into its message, MOT-10).
 */
export function storableError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(withoutNul(String(error)));
  const code = postgresCode(error);
  if (code === undefined && !error.message.includes('\u0000')) return error;
  // Drizzle writes « Failed query: <sql>\nparams: <values> »: the query helps, the values are someone's data.
  const query = withoutNul(error.message.split('\nparams:')[0] ?? '');
  const message = code === undefined ? query : `${query} [SQLSTATE ${code}]`;
  const safe = new Error(message);
  safe.name = error.name;
  const frames = (error.stack ?? '').split('\n').filter((line) => line.startsWith('    at '));
  safe.stack = [`${error.name}: ${message}`, ...frames].join('\n');
  return safe;
}
