import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DB_HOST: z.string().min(1).default('postgres'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z.string().min(1).default('ecom'),
  DB_USER: z.string().min(1).default('app_user'),
  DB_PASSWORD_FILE: z.string().min(1).default('./secrets/db_password'),
  // Full connection string — not read anywhere in the app itself
  // (DatabaseService still uses the discrete vars above + the rotating
  // password file, since a static string can't survive rotate.sh changing
  // the password without a restart). Exists for external tooling only —
  // psql one-liners, a future ORM CLI — see the Configuration table in
  // README.md for where its real value comes from.
  DB_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const lines = parsed.error.issues
      .map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');

    throw new Error(`Invalid configuration:\n${lines}\n`);
  }

  return parsed.data;
}
