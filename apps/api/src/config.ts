import { z } from 'zod';

/** `1`/`true` or `0`/`false`, as written in an `.env` file. */
const flag = z
  .enum(['1', '0', 'true', 'false'])
  .default('0')
  .transform((value) => value === '1' || value === 'true');

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
    /** Application role: RLS applies, every tenant access goes through `withTenant`. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Owner role (BYPASSRLS): Graphile Worker's own schema, unscoped jobs, migration status for `/ready`. */
    DATABASE_ADMIN_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
    /** Development: run the worker inside the API process (`pnpm dev`). */
    NIRVANA_INLINE_WORKER: flag,
    /** AI service keys pasted in the dashboard are sealed with these (ADR 0016), `v2:<base64>,v1:<base64>`. */
    CREDENTIALS_ENCRYPTION_KEYS: z.string().min(1).optional(),
    /** Development only: AI service keys read from the environment, ignored in production (ADR 0016). Empty = unset. */
    LLM_XAI_API_KEY: optionalValue,
    LLM_GOOGLE_API_KEY: optionalValue,
    LLM_MISTRAL_API_KEY: optionalValue,
    LLM_VENICE_API_KEY: optionalValue,
    SPEECH_ELEVENLABS_API_KEY: optionalValue,
    /** AES-256-GCM keys of the platform sessions, `v2:<base64>,v1:<base64>` newest first (security.md). */
    SESSION_ENCRYPTION_KEYS: z.string().optional(),
    /** Device token of the extension's « Sync » (`POST /v1/connector/sessions`); `openssl rand -base64 32`. */
    EXTENSION_DEVICE_TOKEN: z.string().optional(),
    /** Entraîner > Playground: the persona YAML to train on; the fictional demo persona when absent (ADR 0010). */
    PLAYGROUND_PERSONA_PATH: optionalValue,
    /** Where the playground ratings are kept, out of the repository; `.scratch/training` when absent. */
    NIRVANA_TRAINING_DIR: optionalValue,
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
      config.NODE_ENV !== 'production' || (secretOrNull(config.EXTENSION_DEVICE_TOKEN)?.length ?? 0) >= 32,
    {
      message: 'EXTENSION_DEVICE_TOKEN is missing, too short or still holds the .env.example placeholder',
      path: ['EXTENSION_DEVICE_TOKEN'],
    },
  )
  .superRefine((config, context) => {
    for (const prefix of INVOICE_BUCKETS) {
      const set = BUCKET_FIELDS.filter((field) => secretOrNull(config[`${prefix}${field}`]) !== null);
      // Half a bucket is a mistake, never a reason to fall back to memory; production needs both whole.
      if (set.length === BUCKET_FIELDS.length || (set.length === 0 && config.NODE_ENV !== 'production'))
        continue;
      context.addIssue({
        code: 'custom',
        message: `${prefix}* must all be set${config.NODE_ENV === 'production' ? ' in production (ADR 0037)' : ', or none'}`,
        path: [`${prefix}BUCKET`],
      });
    }
  });

const INVOICE_BUCKETS = ['INVOICES_S3_', 'INVOICES_COPY_S3_'] as const;
const BUCKET_FIELDS = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'] as const;

export type Config = Readonly<z.infer<typeof configSchema>>;

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

/** Parses the environment; throws with every invalid variable listed when the configuration is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}
