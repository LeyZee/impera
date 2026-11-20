import type { ErrorEvent, Exception, StackFrame } from '@sentry/node';

/**
 * The last door before Sentry (OPS-18): every event, the API's, the worker's and the dashboard's, is rebuilt here from
 * an allowlist, never trimmed from what the SDK filled in. Anything not named below is dropped: the request with its
 * address, query, headers, cookies and body, the user, the extras, the breadcrumbs, the contexts but the runtime and the
 * system, the server's name, the modules. The text that stays (an error's message, a tag) loses what looks like an
 * e-mail, an address, a bearer token, an opaque token or a long run of digits, and is cut to a short line: a fan's
 * message or a creator's money can only reach Sentry by being quoted in an error, and then not whole.
 */

const VALUE_MAX = 300;
/** Read at most this much of a text before scrubbing it: bounds the work on a message of any size. */
const SCAN_MAX = 10_000;
const NAME_MAX = 100;
const TAG_MAX = 200;
const FRAMES_MAX = 50;
const EXCEPTIONS_MAX = 5;

/** The tags that may leave: where it happened, never who nor what. */
const TAGS = ['service', 'route', 'task', 'attempt', 'web_release'] as const;
/** The dashboard's own release, as its bundle says it: a tag, never the event's release (the API's). */
const WEB_RELEASE = /^[\w.-]{1,64}$/u;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const LEVELS = new Set(['fatal', 'error', 'warning', 'log', 'info', 'debug']);

/**
 * Every pattern below is linear in the length of the text (10 000 characters at most, `SCAN_MAX`): the text is cut into
 * words by one class without alternation, and each word is judged on its own; quotes are found by a scan, never by a
 * pattern that could backtrack. A hostile message costs a pass, never a stall of the event loop.
 */
const WORD = /[^\s"'`<>(),;[\]«»“”‘’]+/gu;
const SCHEME = /^[a-z][a-z0-9+.-]{0,30}:\/\//iu;
/** A key, a session, a JWT: one long run without a space nor a sign of prose. */
const OPAQUE = /[\w-]{32,}(?:\.[\w-]{8,})*/gu;
const DIGITS = /\d{6,}/gu;

/** Our own ids (ADR 0011): they name a row, never a person, and are what makes an error findable. Kept whole. */
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu;

/** What stands for a quoted text, whatever it was. */
const QUOTED_PLACEHOLDER = '[texte]';

/** Each opening quote and the one that closes it. */
const QUOTES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['«', '»'],
  ['“', '”'],
  ['‘', '’'],
]);

/** A quoted segment kept as it is: one word of code (`'foo'`, `"user_id"`, `'$ref'`), never prose. */
const IDENTIFIER = /^[\p{L}\p{N}_$.-]{1,40}$/u;

/**
 * What an error quotes is masked (Sécurité on #895): `JSON.parse` quotes the start of what it was given (a model's
 * answer, a connector's body), a library quotes the value it refused, in the browser too, and that can be a fan's
 * sentence. Every segment between quotes becomes `[texte]` unless it is one identifier; a quote never closed masks to the
 * end; Postgres's `Key (column)=(value)` loses its value. An apostrophe inside a word (`l'élément`) opens nothing,
 * and closes nothing either: `'` and `’` close a segment only where no letter or digit follows them, so
 * `'je t'aime fort'` is masked whole (French puts apostrophes inside what is quoted).
 */
/** Closes like an apostrophe: the one followed by a letter or a digit is inside a word (`t'aime`, `j’ai`). */
const APOSTROPHES: ReadonlySet<string> = new Set(["'", '’']);

/** Where the segment opened before `from` closes, or -1: linear, never going back. */
function closingIndex(text: string, closing: string, from: number): number {
  let end = text.indexOf(closing, from);
  if (!APOSTROPHES.has(closing)) return end;
  while (end >= 0 && /[\p{L}\p{N}]/u.test(text.charAt(end + 1))) end = text.indexOf(closing, end + 1);
  return end;
}

export function maskQuoted(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    // Postgres: `Key (email)=(fan@example.test) already exists` — the value up to the last `)` of the text.
    if (char === '=' && text.charAt(index + 1) === '(') {
      const close = text.lastIndexOf(')');
      if (close <= index + 1) return `${out}=(${QUOTED_PLACEHOLDER}`;
      out += `=(${QUOTED_PLACEHOLDER})`;
      index = close + 1;
      continue;
    }
    const closing = QUOTES.get(char);
    const previous = index === 0 ? '' : text.charAt(index - 1);
    const insideWord = char === "'" && /[\p{L}\p{N}]/u.test(previous);
    if (closing === undefined || insideWord) {
      out += char;
      index += 1;
      continue;
    }
    const end = closingIndex(text, closing, index + 1);
    if (end < 0) return `${out}${char}${QUOTED_PLACEHOLDER}`;
    const quoted = text.slice(index + 1, end);
    out += `${char}${IDENTIFIER.test(quoted) ? quoted : QUOTED_PLACEHOLDER}${closing}`;
    index = end + 1;
  }
  return out;
}

/** A word, without what could reach someone: an address, an e-mail, a token, a long number. */
function scrubWord(word: string, afterBearer: boolean): string {
  if (afterBearer) return '[token]';
  if (SCHEME.test(word) || word.toLowerCase().startsWith('www.')) return '[url]';
  if (word.includes('@')) return '[email]';
  return word.replace(OPAQUE, '[token]').replace(DIGITS, '[number]');
}

function scrubPart(part: string): string {
  let afterBearer = false;
  return part.replace(WORD, (word) => {
    const scrubbed = scrubWord(word, afterBearer);
    afterBearer = word.toLowerCase() === 'bearer';
    return scrubbed;
  });
}

/** A text without what could name or reach someone, on one line of at most `max` characters. */
export function scrubText(text: string, max: number = VALUE_MAX): string {
  // `split` with a capturing group keeps the ids at the odd places.
  const line = text
    .slice(0, SCAN_MAX)
    .split(UUID)
    .map((part, index) => (index % 2 === 1 ? part : scrubPart(part)))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * A frame's file, without the machine's folders, an origin or a query: `apps/api/dist/index.js`,
 * `node_modules/pg/lib/client.js`, `assets/index-3f2a.js`, `node:internal/…` as is.
 */
function fileOf(filename: string): string {
  if (filename.startsWith('node:')) return scrubText(filename, NAME_MAX);
  const path = (filename.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu, '').split(/[?#]/u)[0] ?? '').replace(
    /\\/gu,
    '/',
  );
  const start = path.search(/(?:^|\/)(?:node_modules|apps|packages|assets)\//u);
  const kept = start < 0 ? (path.split('/').pop() ?? '') : path.slice(start).replace(/^\//u, '');
  return scrubText(kept, NAME_MAX);
}

function frameOf(frame: StackFrame): StackFrame {
  return {
    ...(frame.filename === undefined ? {} : { filename: fileOf(frame.filename) }),
    ...(frame.function === undefined ? {} : { function: scrubText(frame.function, NAME_MAX) }),
    ...(typeof frame.lineno === 'number' ? { lineno: frame.lineno } : {}),
    ...(typeof frame.colno === 'number' ? { colno: frame.colno } : {}),
    ...(typeof frame.in_app === 'boolean' ? { in_app: frame.in_app } : {}),
  };
}

function exceptionOf(exception: Exception): Exception {
  // The frames nearest the throw are the last ones (Sentry's order): those are kept.
  const frames = (exception.stacktrace?.frames ?? []).slice(-FRAMES_MAX).map(frameOf);
  const mechanism = exception.mechanism;
  return {
    ...(exception.type === undefined ? {} : { type: scrubText(exception.type, NAME_MAX) }),
    ...(exception.value === undefined
      ? {}
      : { value: scrubText(maskQuoted(exception.value.slice(0, SCAN_MAX))) }),
    ...(mechanism === undefined
      ? {}
      : {
          mechanism: {
            type: scrubText(mechanism.type, NAME_MAX),
            ...(typeof mechanism.handled === 'boolean' ? { handled: mechanism.handled } : {}),
          },
        }),
    ...(frames.length === 0 ? {} : { stacktrace: { frames } }),
  };
}

function tagsOf(tags: ErrorEvent['tags']): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of TAGS) {
    const value = tags?.[name];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = scrubText(String(value), TAG_MAX);
    if (name === 'web_release' && !WEB_RELEASE.test(text)) continue;
    kept[name] = text;
  }
  return kept;
}

/** The runtime and the system, by name and version: nothing about the machine nor the app's memory. */
function contextsOf(contexts: ErrorEvent['contexts']): NonNullable<ErrorEvent['contexts']> {
  const kept: NonNullable<ErrorEvent['contexts']> = {};
  for (const name of ['runtime', 'os'] as const) {
    const context = contexts?.[name];
    if (context === undefined) continue;
    const named = {
      ...(typeof context.name === 'string' ? { name: scrubText(context.name, NAME_MAX) } : {}),
      ...(typeof context.version === 'string' ? { version: scrubText(context.version, NAME_MAX) } : {}),
    };
    if (Object.keys(named).length > 0) kept[name] = named;
  }
  return kept;
}

/**
 * The request as a method and the route's template, the same as the `route` tag (`/v1/fans/:fanId`): an address that is
 * not that template (a path with its ids, a query) is dropped with the rest.
 */
function requestOf(event: ErrorEvent, route: string | undefined): ErrorEvent['request'] {
  const method = event.request?.method?.toUpperCase();
  const url = event.request?.url;
  const kept = {
    ...(method !== undefined && METHODS.has(method) ? { method } : {}),
    ...(url !== undefined && route !== undefined && url === route ? { url: route } : {}),
  };
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * `beforeSend`: the event rebuilt from the allowlist, or `null` (not sent) when there is no error in it or when it cannot
 * be rebuilt or serialized. Never throws: an event that fails here is dropped, never sent as it came.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    const exceptions = (event.exception?.values ?? []).slice(-EXCEPTIONS_MAX).map(exceptionOf);
    if (exceptions.length === 0) return null;
    const tags = tagsOf(event.tags);
    const contexts = contextsOf(event.contexts);
    const request = requestOf(event, tags['route']);
    const clean: ErrorEvent = {
      type: undefined,
      ...(event.event_id === undefined ? {} : { event_id: event.event_id }),
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
      ...(event.platform === undefined ? {} : { platform: scrubText(event.platform, NAME_MAX) }),
      ...(event.level !== undefined && LEVELS.has(event.level) ? { level: event.level } : {}),
      ...(event.release === undefined ? {} : { release: scrubText(event.release, NAME_MAX) }),
      ...(event.environment === undefined ? {} : { environment: scrubText(event.environment, NAME_MAX) }),
      ...(event.sdk?.name === undefined || event.sdk.version === undefined
        ? {}
        : { sdk: { name: event.sdk.name, version: event.sdk.version } }),
      exception: { values: exceptions },
      ...(Object.keys(tags).length === 0 ? {} : { tags }),
      ...(Object.keys(contexts).length === 0 ? {} : { contexts }),
      ...(request === undefined ? {} : { request }),
    };
    // What cannot be written is not sent.
    JSON.stringify(clean);
    return clean;
  } catch {
    return null;
  }
}
