import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // PgBouncer (HW #15), not Postgres directly.
  DB_HOST: z.string().min(1).default('pgbouncer'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(6432),
  DB_NAME: z.string().min(1).default('ecom'),
  DB_USER: z.string().min(1).default('app_user'),
  // Compose mounts the `db_password` secret at /run/secrets/db_password in
  // both dev and prod — a relative path here only "worked" in dev by
  // accident, because dev also bind-mounts the whole repo. Prod has no such
  // bind mount, so a relative path is unreachable there.
  DB_PASSWORD_FILE: z.string().min(1).default('/run/secrets/db_password'),
  // Full connection string — not read anywhere in the app itself
  // (DatabaseService still uses the discrete vars above + the rotating
  // password file, since a static string can't survive rotate.sh changing
  // the password without a restart). Exists for external tooling only —
  // psql one-liners, a future ORM CLI — see the Configuration table in
  // README.md for where its real value comes from.
  DB_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // RabbitMQ (HW #19). AMQP is 5672 — 15672 is the management web UI and
  // does not speak AMQP.
  BROKER_URL: z.url({ protocol: /^amqps?$/ }),
  // Cache Redis instance (HW #23). Read live by CacheRedisConnection —
  // unlike DB_URL above, this is not cosmetic.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Queue/session Redis instance (HW #23 points 3-5). Read live by
  // QueueRedisConnection as of point 4 (RateLimitGuard's
  // TokenBucketService) and point 5 (the webhook worker's Queue/Worker
  // connections); demo-session.ts (point 3) still connects to it directly,
  // host-side.
  REDIS_QUEUE_URL: z.url({ protocol: /^rediss?$/ }),
  // Access-token signing (HW #24). Sourced from the vault, same as every
  // other secret — no default here, a default would mean a key baked into
  // the code. kid is a label, not a secret; the two keys are base64 of a
  // PEM (PKCS#8 private / SPKI public) each, so a multi-line PEM survives
  // export intact (see src/config/jwt-keys.ts for the decode step).
  JWT_KID: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  // Refresh-token hashing (HW #24). Mixed into the HMAC alongside the
  // presented token before it's compared to the stored hash — kept outside
  // the database specifically so a DB dump alone can't be used to forge or
  // verify a refresh token. Base64 of >=32 random bytes.
  REFRESH_TOKEN_PEPPER: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  return parseWith(envSchema, raw);
}

// Worker processes serve no HTTP, so PORT is optional for them. Everything
// else (DB_URL, BROKER_URL) is still required.
const workerEnvSchema = envSchema.partial({ PORT: true });

export function validateWorker(raw: Record<string, unknown>): Env {
  return parseWith(workerEnvSchema, raw) as Env;
}

// The webhook worker (HW #23 point 5) is the only process that reads
// ORDER_STATUS_WEBHOOK_URL — not added to the shared envSchema, since the
// `api` process never reads it and shouldn't be required to validate it.
const webhookWorkerEnvSchema = workerEnvSchema.extend({
  ORDER_STATUS_WEBHOOK_URL: z.url().optional(),
});

export type WebhookWorkerEnv = z.infer<typeof webhookWorkerEnvSchema>;

export function validateWebhookWorker(
  raw: Record<string, unknown>,
): WebhookWorkerEnv {
  return parseWith(webhookWorkerEnvSchema, raw);
}

function parseWith<T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>,
): z.infer<T> {
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const lines = parsed.error.issues
      .map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');

    throw new Error(`Invalid configuration:\n${lines}\n`);
  }

  return parsed.data;
}
