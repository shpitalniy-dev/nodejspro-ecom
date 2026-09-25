import type { ListResponse } from '../../types/index.ts';
import { Currency } from '../../types/index.ts';

export interface Product {
  id: number;
  key: string;
  price_cents: number;
  currency: Currency;
  created_at: string;
}

export type ProductListResponse = ListResponse<Product>;
