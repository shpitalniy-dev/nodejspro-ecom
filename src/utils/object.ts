const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const stripDangerousKeys = (key: string, value: unknown) =>
  DANGEROUS_KEYS.has(key) ? undefined : value;
