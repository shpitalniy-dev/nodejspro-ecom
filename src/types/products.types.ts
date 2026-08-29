import { Currency } from './types.ts';

export interface Product {
  id: number;
  name: string;
  price_cents: number;
  currency: Currency;
  created_at: string;
}
