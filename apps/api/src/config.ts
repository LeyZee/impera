import { z } from 'zod';

import { DEFAULT_SANDBOX_URL, isLoopbackUrl } from './sandbox';

/** `1`/`true` or `0`/`false`, as written in an `.env` file. */
// Empty counts as unset, as `KEY=` in a .env does for every optional variable (recette 07/11, BIL-02).
const flag = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .enum(['1', '0', 'true', 'false'])
    .default('0')
    .transform((value) => value === '1' || value === 'true'),
);

/**
 * An optional secret, or `null` when unset or still the `.env.example` placeholder (`replace-…`): in development
 * the feature that needs it stays off; production refuses to start (below).
 */
export function secretOrNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' || value.includes('replace-') ? null : value;
}

/** A value left empty in `.env` (a path, a key) counts as unset, like a secret (`secretOrNull`). */
const optionalValue = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

/**
 * The only place that reads `process.env` (operations.md). Validated once at startup, frozen, and passed down.
 * Each task adds the variables it needs, documented in `.env.example`.
 */
const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Commit SHA of the running image (Sentry release, worker heartbeat); `dev` locally. */
    RELEASE: z.string().min(1).default('dev'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    /**
     * The interface the API listens on. `localhost` (this machine alone, IPv4 and IPv6) unless set: a developer's
     * computer never serves the API to its local network. The production image sets `0.0.0.0`, reached by the
     * deployment's private network only (docker-compose.prod.yml publishes no port for it).
     */
    HOST: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).default('localhost')),
    /** Application role: RLS applies, every tenant access goes through `withTenant`. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /**
     * Service role (ADR 0087): BYPASSRLS and rights on rows only, it owns nothing. `withAdmin`, the job queue and the
     * migration status of `/ready` run on it; the API and the worker refuse to start on a role that can do more.
     */
    DATABASE_SERVICE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /**
     * Owner role: the migrations, the backup and the `ops:*` scripts run by hand (`ownerDatabaseUrl`). Neither the
     * API nor the worker connects with it, so it may be left out of their environment.
     */
    DATABASE_ADMIN_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    ),
    /** The dashboard origin: the only one CORS lets in and the only one a mutation may come from (security.md §6). */
    WEB_ORIGIN: z.url(),
    /** Signs the dashboard session cookies (Better Auth); `openssl rand -base64 32`. */
    AUTH_SECRET: z.string().min(32),
    /** Public URL the browser reaches the API on (through the dashboard's proxy in development). */
    AUTH_BASE_URL: z.url(),
    /** Requests per minute and per IP before `429` (security.md §6). */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    /**
     * Reverse proxies in front of the API (Coolify's Traefik in production: 1). The client IP of the rate limits
     * and of the audit is read from `x-forwarded-for` past that many hops only; 0 trusts no header.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Jobs a worker runs at once; jobs of one conversation stay serial whatever this is (ADR 0006). */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    /**
     * Connections each process may hold, pool by pool (ADR 0152 § 2). Behind Supabase's pooler in session mode every
     * client connection holds a server one, so the sum over the API and the worker (plus `migrate` and `backup`) must
     * stay under the pool size of the project's compute: the runbook writes that budget down. The defaults are the
     * sizes used until now.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    /** The service role's pool: `withAdmin` and the job queue, so the worker's Graphile Worker runs on it. */
    DATABASE_SERVICE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    /** The rate limiter's own pool (ADR 0027 § 6), apart so a slow count never takes a connection of the modules. */
    RATE_LIMIT_POOL_MAX: z.coerce.number().int().min(1).max(10).default(3),
    /** Development: run the worker inside the API process (`pnpm dev`). */
    IMPERA_INLINE_WORKER: flag,
    /**
     * The recette sandbox (ADR 0075): the real adapters and key verifiers aimed at a local fake world, every call
     * outside this machine blocked. Development or test only, every address local (below).
     */
    IMPERA_SANDBOX: flag,
    /** The fake world of `pnpm sandbox:world`; `http://127.0.0.1:4010` when absent. */
    IMPERA_SANDBOX_URL: optionalValue,
    /**
     * Where the redirect service of the link connector answers (ADR 0120 § 3, amendment of 20/11/2026):
     * `https://<domain>`, nothing after. Set by the deployment alone, never by a setting of the CRM. Absent, the link
     * connector is off; present and invalid, the process refuses to start.
     */
    LINK_SERVICE_ORIGIN: optionalValue,
    /** AI service keys pasted in the dashboard are sealed with these (ADR 0016), `v2:<base64>,v1:<base64>`. */
    CREDENTIALS_ENCRYPTION_KEYS: z.string().min(1).optional(),
    /**
     * `off` skips the check of known-breached passwords (ADR 0046 § 4) on a machine without access to its service, in
     * development or a recette only (recette MOT-14); production refuses to start with it (below).
     */
    PASSWORD_BREACH_CHECK: z.enum(['on', 'off']).default('on'),
    /**
     * The full reading of the fan cards (ADR 0085 § 7, amendement du 21/11): `on` reads every conversation to its start,
     * chains the reads, reads caught-up history and re-reads the week's conversations each Monday. `off` (default) reads
     * as before, the newest messages only, so nothing more is spent before Charles turns it on at go-live.
     */
    FAN_CARD_FULL_READ: z.enum(['on', 'off']).default('off'),
    /** Development only: AI service keys read from the environment, ignored in production (ADR 0016). Empty = unset. */
    LLM_XAI_API_KEY: optionalValue,
    LLM_GOOGLE_API_KEY: optionalValue,
    LLM_MISTRAL_API_KEY: optionalValue,
    LLM_VENICE_API_KEY: optionalValue,
    SPEECH_ELEVENLABS_API_KEY: optionalValue,
    /** AES-256-GCM keys of the platform sessions, `v2:<base64>,v1:<base64>` newest first (security.md). */
    SESSION_ENCRYPTION_KEYS: z.string().optional(),
    /** Entraîner > Playground: the persona YAML to train on; the fictional demo persona when absent (ADR 0010). */
    PLAYGROUND_PERSONA_PATH: optionalValue,
    /** Where the playground ratings are kept, out of the repository; `.scratch/training` when absent. */
    IMPERA_TRAINING_DIR: optionalValue,
    /**
     * The invoices' PDFs (ADR 0037 § 4): the Hetzner bucket of ADR 0028, under compliance lock, in its own project.
     * Its key can write and read, never delete. Production only: elsewhere a store in memory takes its place.
     */
    INVOICES_S3_ENDPOINT: optionalValue,
    INVOICES_S3_REGION: optionalValue,
    INVOICES_S3_BUCKET: optionalValue,
    INVOICES_S3_ACCESS_KEY_ID: optionalValue,
    INVOICES_S3_SECRET_ACCESS_KEY: optionalValue,
    /** Their second copy (ADR 0037 § 6), at OVHcloud, under the same lock: a provider that shares nothing with Hetzner. */
    INVOICES_COPY_S3_ENDPOINT: optionalValue,
    INVOICES_COPY_S3_REGION: optionalValue,
    INVOICES_COPY_S3_BUCKET: optionalValue,
    INVOICES_COPY_S3_ACCESS_KEY_ID: optionalValue,
    INVOICES_COPY_S3_SECRET_ACCESS_KEY: optionalValue,
    /**
     * The media bucket (CR-06 b, ADR 0055 § 3): her drops go up there straight from her phone, raw under `incoming/`
     * (24 hours at most), then cleaned. Unset, every send answers 503: nothing is kept in memory in its place.
     */
    S3_ENDPOINT: optionalValue,
    S3_REGION: optionalValue,
    S3_BUCKET: optionalValue,
    S3_ACCESS_KEY_ID: optionalValue,
    S3_SECRET_ACCESS_KEY: optionalValue,
    /**
     * Where production errors go (OPS-18): a Sentry DSN, EU region, `https://<key>@<host>/<project>`. Required in
     * production (below); unset elsewhere, error reporting stays inert: no client, no network.
     */
    SENTRY_DSN: optionalValue,
  })
  .superRefine((config, context) => {
    // ADR 0075: never outside a developer's machine. Production refuses it, and so does any address that is not
    // this machine, so that a recette server reachable by others can never run against the fake world.
    if (!config.IMPERA_SANDBOX) return;
    if (config.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        message: 'IMPERA_SANDBOX is for development only, never production (ADR 0075)',
        path: ['IMPERA_SANDBOX'],
      });
      return;
    }
    const local = {
      AUTH_BASE_URL: config.AUTH_BASE_URL,
      WEB_ORIGIN: config.WEB_ORIGIN,
      IMPERA_SANDBOX_URL: config.IMPERA_SANDBOX_URL ?? DEFAULT_SANDBOX_URL,
      ...(secretOrNull(config.S3_ENDPOINT) === null ? {} : { S3_ENDPOINT: config.S3_ENDPOINT ?? '' }),
      ...(secretOrNull(config.INVOICES_S3_ENDPOINT) === null
        ? {}
        : { INVOICES_S3_ENDPOINT: config.INVOICES_S3_ENDPOINT ?? '' }),
      ...(secretOrNull(config.INVOICES_COPY_S3_ENDPOINT) === null
        ? {}
        : { INVOICES_COPY_S3_ENDPOINT: config.INVOICES_COPY_S3_ENDPOINT ?? '' }),
    };
    for (const [field, value] of Object.entries(local)) {
      if (!isLoopbackUrl(value)) {
        context.addIssue({
          code: 'custom',
          message: `${field} must be an address on this machine in the sandbox (ADR 0075)`,
          path: [field],
        });
      }
    }
  })
  .superRefine((config, context) => {
    // ADR 0152 § 2: a base reached over the network is reached in TLS whose certificate is checked, never in clear
    // nor on a certificate taken on trust. A base on this machine or behind a service name of the compose (the CI,
    // a rehearsal) is not on the network.
    if (config.NODE_ENV !== 'production') return;
    const urls = {
      DATABASE_URL: config.DATABASE_URL,
      DATABASE_SERVICE_URL: config.DATABASE_SERVICE_URL,
      ...(config.DATABASE_ADMIN_URL === undefined ? {} : { DATABASE_ADMIN_URL: config.DATABASE_ADMIN_URL }),
    };
    for (const [field, value] of Object.entries(urls)) {
      const url = new URL(value);
      if (!isNetworkDatabaseHost(url.hostname)) continue;
      // One sslmode only: given twice, the connection library may keep the last one.
      const modes = url.searchParams.getAll('sslmode');
      if (modes.length !== 1 || modes[0] !== 'verify-full') {
        context.addIssue({
          code: 'custom',
          message: `${field} reaches a remote base: it must carry sslmode=verify-full, once (ADR 0152 § 2, deploy.md)`,
          path: [field],
        });
      }
    }
  })
  .refine((config) => config.NODE_ENV !== 'production' || config.PASSWORD_BREACH_CHECK === 'on', {
    message: 'PASSWORD_BREACH_CHECK=off is for development only (ADR 0046 § 4)',
    path: ['PASSWORD_BREACH_CHECK'],
  })
  .refine(
    // `.env.example` placeholders are long enough to pass `min(32)`; production must not start with one.
    (config) => config.NODE_ENV !== 'production' || !config.AUTH_SECRET.startsWith('replace-'),
    { message: 'AUTH_SECRET still holds the .env.example placeholder', path: ['AUTH_SECRET'] },
  )
  .refine(
    (config) => config.NODE_ENV !== 'production' || secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS) !== null,
    {
      message: 'required in production, not the .env.example placeholder (ADR 0016)',
      path: ['CREDENTIALS_ENCRYPTION_KEYS'],
    },
  )
  .refine(
    (config) => config.NODE_ENV !== 'production' || secretOrNull(config.SESSION_ENCRYPTION_KEYS) !== null,
    {
      message: 'SESSION_ENCRYPTION_KEYS is missing or still holds the .env.example placeholder',
      path: ['SESSION_ENCRYPTION_KEYS'],
    },
  )
  .refine(
    (config) =>
      config.LINK_SERVICE_ORIGIN === undefined || linkServiceOriginOf(config.LINK_SERVICE_ORIGIN) !== null,
    {
      // The value is never echoed: the name of the host says which service the agency uses.
      message:
        'LINK_SERVICE_ORIGIN must be https://<domain>: no port, path, credentials, IP address nor localhost',
      path: ['LINK_SERVICE_ORIGIN'],
    },
  )
  .refine((config) => config.SENTRY_DSN === undefined || sentryDsnOf(config.SENTRY_DSN) !== null, {
    message: 'SENTRY_DSN must be an https Sentry DSN, https://<key>@<host>/<project>',
    path: ['SENTRY_DSN'],
  })
  .refine((config) => config.NODE_ENV !== 'production' || config.SENTRY_DSN !== undefined, {
    message: 'SENTRY_DSN is required in production: its errors must reach Sentry (OPS-18)',
    path: ['SENTRY_DSN'],
  })
  .superRefine((config, context) => {
    // The media bucket: all five or none, its endpoint a plain URL, https in production. Its name alone counts for
    // none: `.env.example` and the production compose have always given `impera-media`, with nothing else.
    const production = config.NODE_ENV === 'production';
    const set = BUCKET_FIELDS.filter((field) => secretOrNull(config[`S3_${field}`]) !== null);
    if (set.every((field) => field === 'BUCKET' || field === 'REGION')) return;
    if (set.length < BUCKET_FIELDS.length) {
      context.addIssue({ code: 'custom', message: 'S3_* must all be set, or none', path: ['S3_BUCKET'] });
      return;
    }
    const at = endpointOf(config.S3_ENDPOINT);
    if (at === null || (production && at.protocol !== 'https:')) {
      context.addIssue({
        code: 'custom',
        message: `S3_ENDPOINT must be an ${production ? 'https' : 'http(s)'} URL, without a bucket`,
        path: ['S3_ENDPOINT'],
      });
    }
  })
  .superRefine((config, context) => {
    const production = config.NODE_ENV === 'production';
    const whole: {
      readonly prefix: (typeof INVOICE_BUCKETS)[number];
      readonly at: URL;
      readonly bucket: string;
    }[] = [];
    for (const prefix of INVOICE_BUCKETS) {
      const set = BUCKET_FIELDS.filter((field) => secretOrNull(config[`${prefix}${field}`]) !== null);
      if (set.length === BUCKET_FIELDS.length) {
        // A typo in an endpoint would start the API and show only at the first job (Bilan on #335).
        const at = endpointOf(config[`${prefix}ENDPOINT`]);
        if (at === null || (production && at.protocol !== 'https:')) {
          context.addIssue({
            code: 'custom',
            message: `${prefix}ENDPOINT must be an ${production ? 'https' : 'http(s)'} URL, without a bucket`,
            path: [`${prefix}ENDPOINT`],
          });
        } else {
          whole.push({ prefix, at, bucket: config[`${prefix}BUCKET`] ?? '' });
        }
        continue;
      }
      // Half a bucket is a mistake, never a reason to fall back to memory; production needs both whole.
      if (set.length === 0 && !production) continue;
      context.addIssue({
        code: 'custom',
        message: `${prefix}* must all be set${production ? ' in production (ADR 0037)' : ', or none'}`,
        path: [`${prefix}BUCKET`],
      });
    }
    const [primary, copy] = INVOICE_BUCKETS.map((prefix) => whole.find((one) => one.prefix === prefix));
    if (primary === undefined || copy === undefined) return;
    // The second copy lives elsewhere (ADR 0037 § 6): the same bucket would find each PDF « already there », and the
    // copy would not exist with nothing to say so. In production, another provider: never the first one's host.
    const sameBucket =
      locationOf(primary.at) === locationOf(copy.at) &&
      primary.bucket.toLowerCase() === copy.bucket.toLowerCase();
    if (sameBucket || (production && primary.at.hostname === copy.at.hostname)) {
      context.addIssue({
        code: 'custom',
        message: sameBucket
          ? 'INVOICES_COPY_S3_* names the bucket of INVOICES_S3_*: the copy lives in another one (ADR 0037 § 6)'
          : 'INVOICES_COPY_S3_ENDPOINT is the host of INVOICES_S3_ENDPOINT: the copy lives at another provider in production (ADR 0037 § 6)',
        path: ['INVOICES_COPY_S3_ENDPOINT'],
      });
    }
  });

const INVOICE_BUCKETS = ['INVOICES_S3_', 'INVOICES_COPY_S3_'] as const;
const BUCKET_FIELDS = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'] as const;

/** A bucket's endpoint: an http(s) URL with no query, credentials nor fragment; `null` otherwise. */
function endpointOf(value: string | undefined): URL | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  const plain = url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  return plain && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null;
}

/** A public domain name in ASCII: dotted labels of letters, digits and hyphens, a top level of letters. */
const DOMAIN_NAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
/** Names that never leave the machine or its network, whatever a resolver answers. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/**
 * The origin of the redirect service (ADR 0120 § 3, amendment of 20/11/2026): exactly `https://<domain>`, the domain
 * a public name in ASCII; `null` otherwise. No port, path, query, fragment nor credentials; no IP address, no local
 * name, no internationalised label (a look-alike of another host). The link adapter calls this origin and no other.
 */
export function linkServiceOriginOf(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const host = url.hostname;
  const plain = value === `https://${host}` && url.port === '' && url.username === '' && url.password === '';
  const named =
    DOMAIN_NAME.test(host) &&
    !host.split('.').some((label) => label.startsWith('xn--')) &&
    !LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return plain && named ? url.origin : null;
}

/**
 * A Sentry DSN: https, a public key as its user, no password, query nor fragment, a project id as its path; `null`
 * otherwise. Sentry's own parser would refuse a malformed one in silence, and production would report nothing.
 */
function sentryDsnOf(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const plain = url.search === '' && url.hash === '' && url.password === '';
  return plain &&
    url.protocol === 'https:' &&
    url.username !== '' &&
    /^\/(?:[^/]+\/)*\d+$/u.test(url.pathname)
    ? url
    : null;
}

/** Where an endpoint points, as the store builds its URLs (`<endpoint>/<bucket>/<key>`). */
const locationOf = (url: URL): string => `${url.origin}${url.pathname.replace(/\/+$/u, '')}`.toLowerCase();

export type Config = Readonly<z.infer<typeof configSchema>>;

/** The media bucket as the configuration gives it (`S3_*`), `null` when unset. */
export function mediaBucket(config: Config): {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
} | null {
  const [endpoint, region, bucket, accessKeyId, secretAccessKey] = BUCKET_FIELDS.map((field) =>
    secretOrNull(config[`S3_${field}`]),
  );
  return endpoint == null ||
    region == null ||
    bucket == null ||
    accessKeyId == null ||
    secretAccessKey == null
    ? null
    : { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/** A bucket of invoices as the configuration gives it, `null` when unset (development, the tests). */
export function invoiceBucket(
  config: Config,
  which: 'primary' | 'copy',
): {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
} | null {
  const prefix = which === 'primary' ? 'INVOICES_S3_' : 'INVOICES_COPY_S3_';
  const [endpoint, region, bucket, accessKeyId, secretAccessKey] = BUCKET_FIELDS.map((field) =>
    secretOrNull(config[`${prefix}${field}`]),
  );
  return endpoint == null ||
    region == null ||
    bucket == null ||
    accessKeyId == null ||
    secretAccessKey == null
    ? null
    : { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/** The prefix of the variables before the rename: one still set stops the start instead of being ignored. */
const OLD_PREFIX = 'NIRVANA_'; // ADR 0062

/** The owner connection of a script run by hand (`ops:*`); the API and the worker never ask for it (ADR 0087). */
export function ownerDatabaseUrl(config: Config): string {
  if (config.DATABASE_ADMIN_URL === undefined) {
    throw new Error(
      'Invalid configuration: DATABASE_ADMIN_URL is missing, this script runs as the owner role.',
    );
  }
  return config.DATABASE_ADMIN_URL;
}

/**
 * True when a base at this host is reached over the network: neither this machine nor a service name of the compose
 * (a name without a dot, such as `postgres`).
 */
function isNetworkDatabaseHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return false;
  return host.includes('.') || host.includes(':');
}

/** Parses the environment; throws with every invalid variable listed when the configuration is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const renamed = Object.keys(env).filter((name) => name.startsWith(OLD_PREFIX));
  if (renamed.length > 0) {
    throw new Error(
      `Invalid configuration: the project is called Impera now (ADR 0062), rename ${renamed
        .map((name) => `${name} to IMPERA_${name.slice(OLD_PREFIX.length)}`)
        .join(', ')}.`,
    );
  }
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}
