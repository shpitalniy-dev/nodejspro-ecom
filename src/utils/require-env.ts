// Reads a required environment variable. Demos and scripts run through
// scripts/with-secrets.sh, or with SKIP_VAULT=1 and exported values.
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set: run through scripts/with-secrets.sh or export it`,
    );
  }

  return value;
}
