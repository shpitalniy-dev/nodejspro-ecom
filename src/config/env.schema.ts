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
  DB_URL: z.string().url(),
  // RabbitMQ (HW #19). AMQP is 5672 — 15672 is the management web UI and
  // does not speak AMQP.
  BROKER_URL: z.url({ protocol: /^amqps?$/ }),
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
