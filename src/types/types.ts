export const Currencies = {
  USD: 'USD',
} as const;

export type Currency = (typeof Currencies)[keyof typeof Currencies];
